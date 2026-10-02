import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { NotFoundError, TransactionHashConflictError } from '../common/errors';
import { HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE } from '../constants';
import type { JournalTransactionStateId } from '../constants';
import { JournalTransaction } from '../models';
import type { GetOrCreateJournalTransactionParams, GetOrCreateJournalTransactionResult } from '../types';
import { JournalTransactionHistoryRepository } from './JournalTransactionHistoryRepository';

@singleton()
@autoInjectable()
export class JournalTransactionRepository {
  private readonly journalTransactionHistoryRepository: JournalTransactionHistoryRepository;

  constructor(journalTransactionHistoryRepository?: JournalTransactionHistoryRepository) {
    this.journalTransactionHistoryRepository = journalTransactionHistoryRepository!;
  }

  async findById(id: number, tx: Transaction): Promise<JournalTransaction | null> {
    return JournalTransaction.findByPk(id, { transaction: tx });
  }

  async findAllByTransactionHash(transactionHash: string, tx: Transaction): Promise<JournalTransaction[]> {
    return JournalTransaction.findAll({ where: { transactionHash }, order: [['id', 'ASC']], transaction: tx });
  }

  async findAllByUuidToken(uuidToken: string, tx: Transaction): Promise<JournalTransaction[]> {
    return JournalTransaction.findAll({ where: { uuidToken }, order: [['id', 'ASC']], transaction: tx });
  }

  async findAllByIdempotencyTokens(idempotencyTokens: string[], tx: Transaction): Promise<JournalTransaction[]> {
    if (idempotencyTokens.length === 0) return [];

    return JournalTransaction.findAll({ where: { idempotencyToken: idempotencyTokens }, order: [['id', 'ASC']], transaction: tx });
  }

  /** Locks the row; every state change of a journal transaction starts here so concurrent workers serialize. */
  async lockById(id: number, tx: Transaction): Promise<JournalTransaction> {
    const journalTransaction = await JournalTransaction.findByPk(id, { transaction: tx, lock: tx.LOCK.UPDATE });

    if (!journalTransaction) throw new NotFoundError('JournalTransaction', id);

    return journalTransaction;
  }

  async setJournalState(journalTransaction: JournalTransaction, journalTransactionState: JournalTransactionStateId, tx: Transaction): Promise<void> {
    journalTransaction.journalTransactionState = journalTransactionState;
    journalTransaction.updatedDate = new Date();

    await journalTransaction.save({ transaction: tx });
  }

  /** The transaction hash is write-once: NULL -> value is allowed, the same value is a no-op, another value is a conflict. */
  async setTransactionHashOnce(journalTransactionId: number, transactionHash: string, tx: Transaction): Promise<void> {
    const journalTransaction = await this.lockById(journalTransactionId, tx);

    if (journalTransaction.transactionHash === transactionHash) return;

    if (journalTransaction.transactionHash !== null) {
      throw new TransactionHashConflictError(journalTransactionId, journalTransaction.transactionHash, transactionHash);
    }

    journalTransaction.transactionHash = transactionHash;
    journalTransaction.updatedDate = new Date();

    await journalTransaction.save({ transaction: tx });
  }

  async getOrCreateJournalTransaction(params: GetOrCreateJournalTransactionParams, tx: Transaction): Promise<GetOrCreateJournalTransactionResult> {
    const [journalTransaction, created] = await JournalTransaction.findOrCreate({
      where: { idempotencyToken: params.idempotencyToken },
      defaults: {
        uuidToken: params.uuidToken,
        transactionTypeId: params.transactionTypeId,
        fromAccountId: params.fromAccountId ?? null,
        toAccountId: params.toAccountId ?? null,
        transactionHash: params.transactionHash ?? null,
        sourceContent: params.sourceContent ?? null,
        idempotencyToken: params.idempotencyToken,
        journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
        businessPostDateTime: params.businessPostDateTime,
        createdBy: params.createdBy ?? null,
      },
      transaction: tx,
    });

    if (created) {
      await this.journalTransactionHistoryRepository.record(
        {
          journalTransaction,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.CREATED,
          transactionStateId: params.transactionStateId ?? null,
          createdBy: params.createdBy,
        },
        tx,
      );
    }

    return { journalTransaction, created };
  }
}
