import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE } from '../constants';
import { GetOrCreateJournalTransactionParams, GetOrCreateJournalTransactionResult, UpdateJournalTransactionParams } from '../interfaces';
import { NotFoundError } from '../common/errors';
import { JournalTransaction } from '../models';
import { BookPostingRepository } from './BookPosting';
import { JournalTransactionHistoryRepository } from './JournalTransactionHistory';

@singleton()
@autoInjectable()
export class JournalTransactionRepository {
  private readonly historyRepository: JournalTransactionHistoryRepository;
  private readonly bookPostingRepository: BookPostingRepository;

  constructor(historyRepository?: JournalTransactionHistoryRepository, bookPostingRepository?: BookPostingRepository) {
    this.historyRepository = historyRepository!;
    this.bookPostingRepository = bookPostingRepository!;
  }

  async findById(id: number, transaction: Transaction): Promise<JournalTransaction | null> {
    return JournalTransaction.findByPk(id, { transaction });
  }

  async findByTransactionHash(transactionHash: string, transaction: Transaction): Promise<JournalTransaction | null> {
    return JournalTransaction.findOne({ where: { transactionHash }, transaction });
  }

  async findAllByTransactionHash(transactionHash: string, transaction: Transaction): Promise<JournalTransaction[]> {
    return JournalTransaction.findAll({ where: { transactionHash }, order: [['id', 'ASC']], transaction });
  }

  async findAllByUuidToken(uuidToken: string, transaction: Transaction): Promise<JournalTransaction[]> {
    return JournalTransaction.findAll({ where: { uuidToken }, order: [['id', 'ASC']], transaction });
  }

  /**
   * Updates the JournalTransaction row itself (hash and/or lifecycle state).
   * The per-transition state (AUTHORIZING..CONFIRMED) is recorded in JournalTransactionHistory by the pipeline.
   */
  async updateJournalTransaction(params: UpdateJournalTransactionParams, transaction: Transaction): Promise<JournalTransaction> {
    const journalTransaction = await JournalTransaction.findByPk(params.journalTransactionId, { transaction, lock: transaction.LOCK.UPDATE });

    if (!journalTransaction) {
      throw new NotFoundError('JournalTransaction', params.journalTransactionId);
    }

    if (params.transactionHash !== undefined) {
      journalTransaction.transactionHash = params.transactionHash;
    }

    if (params.journalTransactionState !== undefined) {
      journalTransaction.journalTransactionState = params.journalTransactionState;
    }

    journalTransaction.updatedDate = new Date();
    journalTransaction.updatedBy = params.updatedBy ?? null;

    await journalTransaction.save({ transaction });

    return journalTransaction;
  }

  async getCurrentTransactionStateId(journalTransactionId: number, transaction: Transaction): Promise<number | null> {
    return this.bookPostingRepository.findLatestTransactionStateId(journalTransactionId, transaction);
  }

  async getOrCreateJournalTransaction(
    params: GetOrCreateJournalTransactionParams,
    transaction: Transaction,
  ): Promise<GetOrCreateJournalTransactionResult> {
    const values = {
      uuidToken: params.uuidToken,
      transactionTypeId: params.transactionTypeId,
      fromAccountId: params.fromAccountId ?? null,
      toAccountId: params.toAccountId ?? null,
      transactionHash: params.transactionHash ?? null,
      sourceContent: params.sourceContent ?? null,
      idempotencyToken: params.idempotencyToken ?? null,
      journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
      businessPostDateTime: params.businessPostDateTime,
      createdBy: params.createdBy ?? null,
    };

    let journalTransaction: JournalTransaction;
    let created: boolean;

    if (params.idempotencyToken) {
      [journalTransaction, created] = await JournalTransaction.findOrCreate({
        where: { idempotencyToken: params.idempotencyToken },
        defaults: values,
        transaction,
      });
    } else {
      journalTransaction = await JournalTransaction.create(values, { transaction });
      created = true;
    }

    if (created) {
      await this.historyRepository.record(
        {
          journalTransaction,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.CREATED,
          transactionStateId: params.transactionStateId ?? null,
          createdBy: params.createdBy,
        },
        transaction,
      );
    }

    return { journalTransaction, created };
  }
}
