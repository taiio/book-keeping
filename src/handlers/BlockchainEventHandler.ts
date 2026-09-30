import { randomUUID } from 'crypto';
import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { NotFoundError, UnsupportedOperationError } from '../common/errors';
import { UnitOfWork } from '../common/UnitOfWork';
import { BLOCKCHAIN_TRANSACTION_STATE_ID, BOOK_POSTING_PURPOSE, TRANSACTION_TYPE } from '../constants';
import { toLegItem } from '../helpers';
import { LedgerPipeline } from '../ledger/LedgerPipeline';
import type { JournalTransaction } from '../models';
import type { BlockchainMessagePayload, LedgerLeg, TransitionRequest, TransitionResult } from '../types';

@singleton()
@autoInjectable()
export class BlockchainEventHandler {
  private readonly unitOfWork: UnitOfWork;
  private readonly ledgerPipeline: LedgerPipeline;

  constructor(unitOfWork?: UnitOfWork, ledgerPipeline?: LedgerPipeline) {
    this.unitOfWork = unitOfWork!;
    this.ledgerPipeline = ledgerPipeline!;
  }

  async handle(payload: BlockchainMessagePayload): Promise<TransitionResult[]> {
    this.validatePayload(payload);

    return this.unitOfWork.execute(async (tx) => {
      let journalTransactions = await this.ledgerPipeline.findByTransactionHash(payload.transactionHash, tx);

      if (journalTransactions.length === 0) {
        if (payload.status !== BLOCKCHAIN_TRANSACTION_STATE_ID.CONFIRMING) {
          throw new NotFoundError('JournalTransaction for transactionHash', payload.transactionHash);
        }

        journalTransactions = await this.createDepositJournalTransactions(payload, tx);
      }

      const requests = this.buildRequests(journalTransactions, payload);

      return this.ledgerPipeline.processTransition(requests, tx);
    });
  }

  private validatePayload(payload: BlockchainMessagePayload): void {
    if (!payload.transactionHash) {
      throw new UnsupportedOperationError('Blockchain transactionHash is required');
    }

    if (payload.status !== BLOCKCHAIN_TRANSACTION_STATE_ID.CONFIRMING && payload.status !== BLOCKCHAIN_TRANSACTION_STATE_ID.CONFIRMED) {
      throw new UnsupportedOperationError(`Unsupported blockchain status: ${payload.status}`);
    }
  }

  private buildRequests(journalTransactions: JournalTransaction[], payload: BlockchainMessagePayload): TransitionRequest[] {
    const requests: TransitionRequest[] = [];

    const withdraws = journalTransactions.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.WITHDRAW);

    const deposits = journalTransactions.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.DEPOSIT);

    requests.push(...this.buildSenderRequests(withdraws, payload));
    requests.push(...this.buildFeeRequests(withdraws, payload));
    requests.push(...this.buildRecipientRequests(deposits, payload));

    return requests;
  }

  private buildSenderRequests(journalTransactions: JournalTransaction[], payload: BlockchainMessagePayload): TransitionRequest[] {
    return journalTransactions
      .filter((jt) => !this.isSeparateFeeJournal(jt, payload))
      .map((journalTransaction) => ({
        journalTransaction,
        targetStateId: payload.status,
        legs: this.buildSenderLegs(journalTransaction, payload),
      }));
  }

  private buildFeeRequests(journalTransactions: JournalTransaction[], payload: BlockchainMessagePayload): TransitionRequest[] {
    const fee = payload.networkFee;

    if (!fee.account) return [];

    const feeJournal = journalTransactions.find((jt) => this.isSeparateFeeJournal(jt, payload));

    if (!feeJournal) return [];

    return [
      {
        journalTransaction: feeJournal,
        targetStateId: payload.status,
        legs: this.buildFeeLegs(feeJournal, payload),
      },
    ];
  }

  private buildRecipientRequests(journalTransactions: JournalTransaction[], payload: BlockchainMessagePayload): TransitionRequest[] {
    return journalTransactions.map((journalTransaction) => ({
      journalTransaction,
      targetStateId: payload.status,
      legs: this.buildRecipientLegs(journalTransaction, payload),
    }));
  }

  private buildSenderLegs(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): LedgerLeg[] {
    const sender = payload.senders.find((item) => item.idempotencyToken === journalTransaction.idempotencyToken);

    if (!sender?.account) {
      throw new NotFoundError('Blockchain sender for JournalTransaction', journalTransaction.id);
    }

    const legs: LedgerLeg[] = [
      {
        item: toLegItem(sender.account, sender.assetTicker),
        amount: sender.quantity,
        purpose: BOOK_POSTING_PURPOSE.AMOUNT,
      },
    ];

    const fee = payload.networkFee;

    if (fee.account && fee.account.accountId === journalTransaction.fromAccountId) {
      legs.push({
        item: toLegItem(fee.account, fee.assetTicker),
        amount: fee.quantity,
        purpose: BOOK_POSTING_PURPOSE.FEE,
      });
    }

    return legs;
  }

  private buildFeeLegs(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): LedgerLeg[] {
    const fee = payload.networkFee;

    if (!fee.account) {
      throw new NotFoundError('Blockchain fee account for JournalTransaction', journalTransaction.id);
    }

    if (fee.idempotencyToken !== journalTransaction.idempotencyToken) {
      throw new NotFoundError('Blockchain fee for JournalTransaction', journalTransaction.id);
    }

    return [
      {
        item: toLegItem(fee.account, fee.assetTicker),
        amount: fee.quantity,
        purpose: BOOK_POSTING_PURPOSE.FEE,
      },
    ];
  }

  private buildRecipientLegs(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): LedgerLeg[] {
    const recipient = payload.recipients.find((item) => item.idempotencyToken === journalTransaction.idempotencyToken);

    if (!recipient?.account) {
      throw new NotFoundError('Blockchain recipient for JournalTransaction', journalTransaction.id);
    }

    return [
      {
        item: toLegItem(recipient.account, recipient.assetTicker),
        amount: recipient.quantity,
        purpose: BOOK_POSTING_PURPOSE.AMOUNT,
      },
    ];
  }

  private isSeparateFeeJournal(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): boolean {
    const fee = payload.networkFee;

    return Boolean(
      fee.account &&
      journalTransaction.transactionTypeId === TRANSACTION_TYPE.WITHDRAW &&
      journalTransaction.idempotencyToken === fee.idempotencyToken &&
      journalTransaction.fromAccountId === fee.account.accountId &&
      !payload.senders.some(
        (sender) => sender.idempotencyToken === journalTransaction.idempotencyToken && sender.account?.accountId === fee.account!.accountId,
      ),
    );
  }

  private async createDepositJournalTransactions(payload: BlockchainMessagePayload, tx: Transaction): Promise<JournalTransaction[]> {
    const internalRecipients = payload.recipients.filter((recipient) => recipient.account);

    if (internalRecipients.length === 0) {
      return [];
    }

    const uuidToken = payload.uuidToken ?? randomUUID();
    const journalTransactions: JournalTransaction[] = [];

    for (const recipient of internalRecipients) {
      journalTransactions.push(
        await this.ledgerPipeline.createJournalTransaction(
          {
            uuidToken,
            idempotencyToken: recipient.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
            toAccountId: recipient.account!.accountId,
            transactionHash: payload.transactionHash,
            sourceContent: null,
          },
          tx,
        ),
      );
    }

    return journalTransactions;
  }

  private async createSeparateFeeJournalTransaction(
    payload: BlockchainMessagePayload,
    journalTransactions: JournalTransaction[],
    tx: Transaction,
  ): Promise<JournalTransaction[]> {
    const fee = payload.networkFee;

    if (!fee.account) return journalTransactions;

    const hasInternalSender = payload.senders.some((sender) => sender.account);

    if (!hasInternalSender) return journalTransactions;

    const senderPaysFee = payload.senders.some((sender) => sender.account?.accountId === fee.account!.accountId);

    if (senderPaysFee) return journalTransactions;

    const existingFeeJournal = journalTransactions.find((jt) => jt.idempotencyToken === fee.idempotencyToken);

    if (existingFeeJournal) return journalTransactions;

    const feeJournal = await this.ledgerPipeline.createJournalTransaction(
      {
        uuidToken: payload.uuidToken ?? randomUUID(),
        idempotencyToken: fee.idempotencyToken,
        transactionTypeId: TRANSACTION_TYPE.WITHDRAW,
        fromAccountId: fee.account.accountId,
        transactionHash: payload.transactionHash,
        sourceContent: null,
      },
      tx,
    );

    return [...journalTransactions, feeJournal];
  }

  private async ensureSeparateFeeJournalTransaction(
    payload: BlockchainMessagePayload,
    journalTransactions: JournalTransaction[],
    tx: Transaction,
  ): Promise<JournalTransaction[]> {
    const fee = payload.networkFee;

    if (!fee.account) return journalTransactions;

    const hasInternalSender = payload.senders.some((sender) => sender.account);

    if (!hasInternalSender) return journalTransactions;

    const senderPaysFee = payload.senders.some((sender) => sender.account?.accountId === fee.account!.accountId);

    if (senderPaysFee) return journalTransactions;

    const existingFeeJournal = journalTransactions.some(
      (jt) => jt.idempotencyToken === fee.idempotencyToken && jt.fromAccountId === fee.account!.accountId,
    );

    if (existingFeeJournal) return journalTransactions;

    return this.createSeparateFeeJournalTransaction(payload, journalTransactions, tx);
  }
}
