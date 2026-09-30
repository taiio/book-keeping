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
        journalTransactions = await this.createFeeJournalTransaction(payload, journalTransactions, tx);
      }

      const requests = journalTransactions.map((journalTransaction) => this.buildRequest(journalTransaction, payload));

      return this.ledgerPipeline.processTransition(requests, tx);
    });
  }

  private validatePayload(payload: BlockchainMessagePayload): void {
    if (!payload.transactionHash) {
      throw new UnsupportedOperationError('Blockchain transactionHash is required');
    }

    if (
      payload.status !== BLOCKCHAIN_TRANSACTION_STATE_ID.CONFIRMING &&
      payload.status !== BLOCKCHAIN_TRANSACTION_STATE_ID.CONFIRMED
    ) {
      throw new UnsupportedOperationError(`blockchain status ${payload.status}`);
    }
  }

  private buildRequest(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): TransitionRequest {
    const isFee = journalTransaction.idempotencyToken === payload.networkFee.idempotencyToken;

    const legs = isFee
      ? this.feeLegs(journalTransaction, payload)
      : journalTransaction.transactionTypeId === TRANSACTION_TYPE.WITHDRAW
        ? this.senderLegs(journalTransaction, payload)
        : this.recipientLegs(journalTransaction, payload);

    return { journalTransaction, targetStateId: payload.status, legs };
  }

  private async createDepositJournalTransactions(payload: BlockchainMessagePayload, tx: Transaction): Promise<JournalTransaction[]> {
    const internalRecipients = payload.recipients.filter((recipient) => recipient.account);

    if (internalRecipients.length === 0) {
      throw new NotFoundError('Internal recipient for transactionHash', payload.transactionHash);
    }

    const uuidToken = payload.uuidToken ?? randomUUID();
    const journalTransactions: JournalTransaction[] = [];

    for (const recipient of internalRecipients) {
      journalTransactions.push(
        await this.ledgerPipeline.createJournalTransaction({
          uuidToken,
          idempotencyToken: recipient.idempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
          toAccountId: recipient.account!.accountId,
          transactionHash: payload.transactionHash,
          sourceContent: null,
        }, tx),
      );
    }

    return journalTransactions;
  }

  private async createFeeJournalTransaction(
    payload: BlockchainMessagePayload,
    journalTransactions: JournalTransaction[],
    tx: Transaction,
  ): Promise<JournalTransaction[]> {
    const fee = payload.networkFee;

    if (!fee.account) return journalTransactions;

    const existingFeeJournal = journalTransactions.find(
      (journalTransaction) => journalTransaction.idempotencyToken === fee.idempotencyToken,
    );

    if (existingFeeJournal) return journalTransactions;

    const hasInternalSender = payload.senders.some((sender) => sender.account);

    if (!hasInternalSender) return journalTransactions;

    const feeJournalTransaction = await this.ledgerPipeline.createJournalTransaction({
      uuidToken: payload.uuidToken ?? randomUUID(),
      idempotencyToken: fee.idempotencyToken,
      transactionTypeId: TRANSACTION_TYPE.WITHDRAW,
      fromAccountId: fee.account.accountId,
      transactionHash: payload.transactionHash,
      sourceContent: null,
    }, tx);

    return [...journalTransactions, feeJournalTransaction];
  }

  private senderLegs(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): LedgerLeg[] {
    const sender = payload.senders.find(
      (item) => item.idempotencyToken === journalTransaction.idempotencyToken,
    );

    if (!sender?.account) {
      throw new NotFoundError('Blockchain sender for JournalTransaction', journalTransaction.id);
    }

    if (!sender.assetTicker) {
      throw new NotFoundError('Blockchain sender assetTicker for JournalTransaction', journalTransaction.id);
    }

    return [{
      item: toLegItem(sender.account, sender.assetTicker),
      amount: sender.quantity,
      purpose: BOOK_POSTING_PURPOSE.AMOUNT,
    }];
  }

  private feeLegs(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): LedgerLeg[] {
    const fee = payload.networkFee;

    if (fee.idempotencyToken !== journalTransaction.idempotencyToken) {
      throw new NotFoundError('Blockchain fee for JournalTransaction', journalTransaction.id);
    }

    if (!fee.account) {
      throw new NotFoundError('Blockchain fee account for JournalTransaction', journalTransaction.id);
    }

    return [{
      item: toLegItem(fee.account, fee.assetTicker),
      amount: fee.quantity,
      purpose: BOOK_POSTING_PURPOSE.FEE,
    }];
  }

  private recipientLegs(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): LedgerLeg[] {
    const recipient = payload.recipients.find(
      (item) => item.idempotencyToken === journalTransaction.idempotencyToken,
    );

    if (!recipient?.account) {
      throw new NotFoundError('Blockchain recipient for JournalTransaction', journalTransaction.id);
    }

    return [{
      item: toLegItem(recipient.account, recipient.assetTicker),
      amount: recipient.quantity,
      purpose: BOOK_POSTING_PURPOSE.AMOUNT,
    }];
  }
}