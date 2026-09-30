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

      const requests = journalTransactions.map((journalTransaction) => this.buildRequest(journalTransaction, payload));

      return this.ledgerPipeline.processTransition(requests, tx);
    });
  }

  private validatePayload(payload: BlockchainMessagePayload): void {
    if (!payload.transactionHash) {
      throw new UnsupportedOperationError('Blockchain transactionHash is required');
    }

    if (payload.status !== BLOCKCHAIN_TRANSACTION_STATE_ID.CONFIRMING && payload.status !== BLOCKCHAIN_TRANSACTION_STATE_ID.CONFIRMED) {
      throw new UnsupportedOperationError(`blockchain status ${payload.status}`);
    }
  }

  private buildRequest(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): TransitionRequest {
    const legs =
      journalTransaction.transactionTypeId === TRANSACTION_TYPE.WITHDRAW
        ? this.senderLegs(journalTransaction, payload)
        : this.recipientLegs(journalTransaction, payload);

    return {
      journalTransaction,
      targetStateId: payload.status,
      legs,
    };
  }

  private async createDepositJournalTransactions(payload: BlockchainMessagePayload, tx: Transaction): Promise<JournalTransaction[]> {
    const internalRecipients = payload.recipients.filter((recipient) => recipient.account);

    if (internalRecipients.length === 0) {
      throw new NotFoundError('Internal recipient for transactionHash', payload.transactionHash);
    }

    const uuidToken = payload.uuidToken ?? randomUUID();

    const journalTransactions: JournalTransaction[] = [];

    for (const recipient of internalRecipients) {
      const journalTransaction = await this.ledgerPipeline.createJournalTransaction(
        {
          uuidToken,
          idempotencyToken: recipient.idempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
          toAccountId: recipient.account!.accountId,
          transactionHash: payload.transactionHash,
          sourceContent: null,
        },
        tx,
      );

      journalTransactions.push(journalTransaction);
    }

    return journalTransactions;
  }

  private senderLegs(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): LedgerLeg[] {
    const accountId = journalTransaction.fromAccountId;

    if (accountId == null) {
      throw new NotFoundError('fromAccountId for sender JournalTransaction', journalTransaction.id);
    }

    const sender = payload.senders.find((item) => item.account?.accountId === accountId);

    if (!sender?.account) {
      throw new NotFoundError('Blockchain sender account for JournalTransaction', journalTransaction.id);
    }

    if (!sender.assetTicker) {
      throw new NotFoundError('Blockchain sender assetTicker for JournalTransaction', journalTransaction.id);
    }

    const legs: LedgerLeg[] = [
      {
        item: toLegItem(sender.account, sender.assetTicker),
        amount: sender.quantity || '0',
        purpose: BOOK_POSTING_PURPOSE.AMOUNT,
      },
    ];

    const { networkFee } = payload;

    if (networkFee.account && networkFee.account.accountId === accountId) {
      legs.push({
        item: toLegItem(networkFee.account, networkFee.assetTicker),
        amount: networkFee.quantity,
        purpose: BOOK_POSTING_PURPOSE.FEE,
      });
    }

    return legs;
  }

  private recipientLegs(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): LedgerLeg[] {
    const accountId = journalTransaction.toAccountId;

    if (accountId == null) {
      throw new NotFoundError('toAccountId for recipient JournalTransaction', journalTransaction.id);
    }

    const recipient = payload.recipients.find(
      (item) => item.account?.accountId === accountId && item.idempotencyToken === journalTransaction.idempotencyToken,
    );

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

  private async createFeeJournalTransaction(
    payload: BlockchainMessagePayload,
    internalSenderExists: boolean,
    existingJournalTransactions: JournalTransaction[],
    tx: Transaction,
  ): Promise<JournalTransaction | null> {
    if (!internalSenderExists) {
      return null;
    }

    const feeAccount = payload.networkFee.account;

    if (!feeAccount) {
      return null;
    }

    const feeAlreadyBelongsToSender = existingJournalTransactions.some(
      (journalTransaction) =>
        journalTransaction.transactionTypeId === TRANSACTION_TYPE.WITHDRAW && journalTransaction.fromAccountId === feeAccount.accountId,
    );

    if (feeAlreadyBelongsToSender) {
      return null;
    }

    return this.ledgerPipeline.createJournalTransaction(
      {
        uuidToken: payload.uuidToken ?? randomUUID(),
        idempotencyToken: payload.networkFee.idempotencyToken,
        transactionTypeId: TRANSACTION_TYPE.WITHDRAW,
        fromAccountId: feeAccount.accountId,
        transactionHash: payload.transactionHash,
        sourceContent: null,
      },
      tx,
    );
  }
}
