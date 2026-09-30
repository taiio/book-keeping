import type { Transaction } from 'sequelize';
import { autoInjectable, inject, singleton } from 'tsyringe';

import { UnsupportedOperationError } from '../common/errors';
import { UnitOfWork } from '../common/UnitOfWork';
import { BOOK_POSTING_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';
import { isInternalItem, toLegItem } from '../helpers';
import { LedgerPipeline } from '../ledger/LedgerPipeline';
import type { JournalTransaction } from '../models';
import { BLOCKCHAIN_SUBMITTER } from '../ports';
import type { IBlockchainSubmitter } from '../ports';
import type { AccountItem, GetOrCreateJournalTransactionParams, LedgerLeg, SystemTransactionResult, TransitionRequest, Withdraw } from '../types';

type JournalTransactionSide = Pick<GetOrCreateJournalTransactionParams, 'transactionTypeId' | 'fromAccountId' | 'toAccountId'>;

const SUPPORTED_SYSTEM_STATE_IDS: readonly number[] = [TRANSACTION_STATE.AUTHORIZING.id, TRANSACTION_STATE.AUTHORIZED.id, TRANSACTION_STATE.SENT.id];

@singleton()
@autoInjectable()
export class SystemTransactionHandler {
  private readonly unitOfWork: UnitOfWork;
  private readonly ledgerPipeline: LedgerPipeline;
  private readonly blockchainSubmitter: IBlockchainSubmitter;

  constructor(unitOfWork?: UnitOfWork, ledgerPipeline?: LedgerPipeline, @inject(BLOCKCHAIN_SUBMITTER) blockchainSubmitter?: IBlockchainSubmitter) {
    this.unitOfWork = unitOfWork!;
    this.ledgerPipeline = ledgerPipeline!;
    this.blockchainSubmitter = blockchainSubmitter!;
  }

  async handle(withdraw: Withdraw): Promise<SystemTransactionResult> {
    this.validate(withdraw);

    const { transactionStateId } = withdraw;

    if (transactionStateId === TRANSACTION_STATE.AUTHORIZING.id) {
      return this.handleAuthorizing(withdraw);
    }

    const existing = await this.unitOfWork.execute((tx) => this.ledgerPipeline.findByUuidToken(withdraw.uuidToken, tx));

    const senders = existing.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.WITHDRAW);
    const recipients = existing.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.DEPOSIT);

    if (!senders.length) {
      throw new Error(`No sender journal transactions found for uuidToken=${withdraw.uuidToken}`);
    }

    await this.unitOfWork.execute((tx) => this.ledgerPipeline.processTransition(this.senderRequests(withdraw, senders), tx));

    if (transactionStateId !== TRANSACTION_STATE.SENT.id) {
      return this.buildResult(withdraw, senders, recipients);
    }

    const { transactionHash } = await this.blockchainSubmitter.submit(withdraw, senders[0].id);

    const allIds = [...senders, ...recipients].map((jt) => jt.id);

    await this.unitOfWork.execute((tx) => this.ledgerPipeline.attachTransactionHash(allIds, transactionHash, tx));

    return this.buildResult(withdraw, senders, recipients, transactionHash);
  }

  private async handleAuthorizing(withdraw: Withdraw): Promise<SystemTransactionResult> {
    const created = await this.unitOfWork.execute(async (tx) => {
      const existing = await this.ledgerPipeline.findByUuidToken(withdraw.uuidToken, tx);

      if (existing.length > 0) return null;

      const senders = await this.createSenderJournalTransactions(withdraw, tx);
      const recipients = await this.createRecipientJournalTransactions(withdraw, tx);

      await this.ledgerPipeline.processTransition(this.senderRequests(withdraw, senders), tx);

      return { senders, recipients };
    });

    if (!created) {
      return {
        uuidToken: withdraw.uuidToken,
        processed: false,
        transactionHash: null,
        senderJournalTransactionIds: [],
        recipientJournalTransactionIds: [],
      };
    }

    return this.buildResult(withdraw, created.senders, created.recipients);
  }

  private validate(withdraw: Withdraw): void {
    if (withdraw.type !== TRANSACTION_TYPE.WITHDRAW) {
      throw new UnsupportedOperationError(`transaction type ${(withdraw as { type: number }).type}`);
    }

    if (!withdraw.uuidToken) throw new Error('uuidToken is required');
    if (!withdraw.sender?.length) throw new Error('At least one sender is required');
    if (!withdraw.fee) throw new Error('Exactly one fee is required');

    this.validateState(withdraw.transactionStateId);

    if (!withdraw.fee.account) {
      throw new Error('Fee account is required');
    }

    for (const sender of withdraw.sender) {
      if (!sender.account) {
        throw new Error(`Sender must be an internal account: idempotencyToken=${sender.idempotencyToken}`);
      }
    }

    for (const item of [...withdraw.sender, withdraw.fee]) {
      if (!/^[1-9]\d*$/.test(item.quantity)) {
        throw new Error(`Quantity must be a positive integer string: ${item.quantity}`);
      }

      if (!item.idempotencyToken) {
        throw new Error('idempotencyToken is required on every item');
      }
    }
  }

  private validateState(transactionStateId: number): void {
    if (!SUPPORTED_SYSTEM_STATE_IDS.includes(transactionStateId)) {
      throw new UnsupportedOperationError(`Unsupported system transaction state: ${transactionStateId}`);
    }
  }

  private async createSenderJournalTransactions(withdraw: Withdraw, tx: Transaction): Promise<JournalTransaction[]> {
    const sourceContent = JSON.stringify(withdraw);
    const journalTransactions: JournalTransaction[] = [];

    for (const sender of withdraw.sender) {
      journalTransactions.push(
        await this.ledgerPipeline.createJournalTransaction(
          {
            uuidToken: withdraw.uuidToken,
            idempotencyToken: sender.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.WITHDRAW,
            fromAccountId: sender.account!.accountId,
            sourceContent,
          },
          tx,
        ),
      );
    }

    const feeAccountId = withdraw.fee.account!.accountId;
    const senderAccountIds = new Set(withdraw.sender.map((sender) => sender.account!.accountId));

    if (!senderAccountIds.has(feeAccountId)) {
      journalTransactions.push(
        await this.ledgerPipeline.createJournalTransaction(
          {
            uuidToken: withdraw.uuidToken,
            idempotencyToken: withdraw.fee.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.WITHDRAW,
            fromAccountId: feeAccountId,
            sourceContent,
          },
          tx,
        ),
      );
    }

    return journalTransactions;
  }

  private createRecipientJournalTransactions(withdraw: Withdraw, tx: Transaction): Promise<JournalTransaction[]> {
    return this.createJournalTransactions(
      withdraw,
      withdraw.recipient.filter(isInternalItem),
      (recipient) => ({
        transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
        toAccountId: recipient.account.accountId,
      }),
      tx,
    );
  }

  private async createJournalTransactions<T extends AccountItem>(
    withdraw: Withdraw,
    items: T[],
    toSide: (item: T) => JournalTransactionSide,
    tx: Transaction,
  ): Promise<JournalTransaction[]> {
    const sourceContent = JSON.stringify(withdraw);
    const journalTransactions: JournalTransaction[] = [];

    for (const item of items) {
      journalTransactions.push(
        await this.ledgerPipeline.createJournalTransaction(
          {
            uuidToken: withdraw.uuidToken,
            idempotencyToken: item.idempotencyToken,
            ...toSide(item),
            sourceContent,
          },
          tx,
        ),
      );
    }

    return journalTransactions;
  }

  private senderRequests(withdraw: Withdraw, senders: JournalTransaction[]): TransitionRequest[] {
    const requests: TransitionRequest[] = [];

    for (const sender of withdraw.sender) {
      const journalTransaction = senders.find((jt) => jt.idempotencyToken === sender.idempotencyToken);

      if (!journalTransaction) {
        throw new Error(`Sender journal transaction not found: ${sender.idempotencyToken}`);
      }

      const legs: LedgerLeg[] = [
        {
          item: toLegItem(sender.account!, sender.assetTicker),
          amount: sender.quantity,
          purpose: BOOK_POSTING_PURPOSE.AMOUNT,
        },
      ];

      if (withdraw.fee.idempotencyToken === sender.idempotencyToken) {
        legs.push({
          item: toLegItem(withdraw.fee.account, withdraw.fee.assetTicker),
          amount: withdraw.fee.quantity,
          purpose: BOOK_POSTING_PURPOSE.FEE,
        });
      }

      requests.push({
        journalTransaction,
        targetStateId: withdraw.transactionStateId,
        legs,
      });
    }

    return requests;
  }

  private buildResult(
    withdraw: Withdraw,
    senders: JournalTransaction[],
    recipients: JournalTransaction[],
    transactionHash: string | null = null,
  ): SystemTransactionResult {
    return {
      uuidToken: withdraw.uuidToken,
      processed: true,
      transactionHash,
      senderJournalTransactionIds: senders.map((jt) => jt.id),
      recipientJournalTransactionIds: recipients.map((jt) => jt.id),
    };
  }
}
