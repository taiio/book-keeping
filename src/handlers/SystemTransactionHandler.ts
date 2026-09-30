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

/** The account side of a journal transaction: a sender is debited (`fromAccountId`), a recipient is credited (`toAccountId`). */
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

    if (transactionStateId === TRANSACTION_STATE.AUTHORIZING.id) return this.handleAuthorizing(withdraw);

    const existing = await this.unitOfWork.execute((tx) => this.ledgerPipeline.findByUuidToken(withdraw.uuidToken, tx));
    const senders = existing.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.WITHDRAW);
    const recipients = existing.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.DEPOSIT);

    if (!senders.length) throw new Error(`No sender journal transactions found for uuidToken=${withdraw.uuidToken}`);

    await this.unitOfWork.execute((tx) => this.ledgerPipeline.processTransition(this.senderRequests(withdraw, senders), tx));

    if (transactionStateId !== TRANSACTION_STATE.SENT.id) return this.buildResult(withdraw, senders, recipients);

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
    if (withdraw.type !== TRANSACTION_TYPE.WITHDRAW) throw new UnsupportedOperationError(`transaction type ${(withdraw as { type: number }).type}`);
    if (!withdraw.uuidToken) throw new Error('uuidToken is required');
    if (!withdraw.sender?.length) throw new Error('At least one sender is required');
    if (!withdraw.fee) throw new Error('Exactly one fee is required');

    this.validateState(withdraw.transactionStateId);

    if (!withdraw.fee.account) throw new Error('Fee account is required');

    for (const sender of withdraw.sender) {
      if (!sender.account) throw new Error(`Sender must be an internal account: idempotencyToken=${sender.idempotencyToken}`);
    }

    for (const item of [...withdraw.sender, withdraw.fee]) {
      if (!/^[1-9]\d*$/.test(item.quantity)) throw new Error(`Quantity must be a positive integer string: ${item.quantity}`);
      if (!item.idempotencyToken) throw new Error('idempotencyToken is required on every item');
    }
  }

  private validateState(transactionStateId: number): void {
    if (!SUPPORTED_SYSTEM_STATE_IDS.includes(transactionStateId))
      throw new UnsupportedOperationError(`Unsupported system transaction state: ${transactionStateId}`);
  }

  private createSenderJournalTransactions(withdraw: Withdraw, tx: Transaction): Promise<JournalTransaction[]> {
    return this.createJournalTransactions(
      withdraw,
      withdraw.sender,
      (sender) => ({ transactionTypeId: TRANSACTION_TYPE.WITHDRAW, fromAccountId: sender.account?.accountId ?? null }),
      tx,
    );
  }

  private createRecipientJournalTransactions(withdraw: Withdraw, tx: Transaction): Promise<JournalTransaction[]> {
    return this.createJournalTransactions(
      withdraw,
      withdraw.recipient.filter(isInternalItem),
      (recipient) => ({ transactionTypeId: TRANSACTION_TYPE.DEPOSIT, toAccountId: recipient.account.accountId }),
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
    return senders.map((journalTransaction, i) => {
      const item = withdraw.sender[i];
      if (!item) throw new Error(`Missing sender at index ${i}`);

      if (!item.account) throw new Error(`Sender at index ${i} has no internal account`);

      const { fee } = withdraw;
      const legs: LedgerLeg[] = [{ item: toLegItem(item.account, item.assetTicker), amount: item.quantity, purpose: BOOK_POSTING_PURPOSE.AMOUNT }];
      if (i === 0) legs.push({ item: toLegItem(fee.account, fee.assetTicker), amount: fee.quantity, purpose: BOOK_POSTING_PURPOSE.FEE });

      return { journalTransaction, targetStateId: withdraw.transactionStateId, legs };
    });
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
