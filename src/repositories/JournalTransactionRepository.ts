import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { NotFoundError } from '../common/errors';
import { HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE } from '../constants';
import { JournalTransaction } from '../models';
import type { GetOrCreateJournalTransactionParams, GetOrCreateJournalTransactionResult, UpdateJournalTransactionParams } from '../types';
import { BookPostingRepository } from './BookPostingRepository';
import { JournalTransactionHistoryRepository } from './JournalTransactionHistoryRepository';

@singleton()
@autoInjectable()
export class JournalTransactionRepository {
  private readonly journalTransactionHistoryRepository: JournalTransactionHistoryRepository;
  private readonly bookPostingRepository: BookPostingRepository;

  constructor(journalTransactionHistoryRepository?: JournalTransactionHistoryRepository, bookPostingRepository?: BookPostingRepository) {
    this.journalTransactionHistoryRepository = journalTransactionHistoryRepository!;
    this.bookPostingRepository = bookPostingRepository!;
  }

  async findByTransactionHash(transactionHash: string, tx: Transaction): Promise<JournalTransaction | null> {
    return JournalTransaction.findOne({ where: { transactionHash }, transaction: tx });
  }

  async findAllByTransactionHash(transactionHash: string, tx: Transaction): Promise<JournalTransaction[]> {
    return JournalTransaction.findAll({ where: { transactionHash }, order: [['id', 'ASC']], transaction: tx });
  }

  async findAllByUuidToken(uuidToken: string, tx: Transaction): Promise<JournalTransaction[]> {
    return JournalTransaction.findAll({ where: { uuidToken }, order: [['id', 'ASC']], transaction: tx });
  }

  async updateJournalTransaction(params: UpdateJournalTransactionParams, tx: Transaction): Promise<JournalTransaction> {
    const journalTransaction = await JournalTransaction.findByPk(params.journalTransactionId, { transaction: tx, lock: tx.LOCK.UPDATE });

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

    await journalTransaction.save({ transaction: tx });

    return journalTransaction;
  }

  async getOrCreateJournalTransaction(params: GetOrCreateJournalTransactionParams, tx: Transaction): Promise<GetOrCreateJournalTransactionResult> {
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
        transaction: tx,
      });
    } else {
      journalTransaction = await JournalTransaction.create(values, { transaction: tx });
      created = true;
    }

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
