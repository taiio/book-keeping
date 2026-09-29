import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { NotFoundError } from '../common/errors';
import { HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, TERMINAL_JOURNAL_TRANSACTION_STATES, TRANSACTION_STATE_RANK } from '../constants';
import {
  GetOrCreateJournalTransactionParams,
  GetOrCreateJournalTransactionResult,
  UpdateJournalTransactionParams,
  UpdateJournalTransactionResult,
} from '../interfaces';
import { JournalTransaction } from '../models';
import { BookPostingRepository } from './BookPosting';
import { JournalTransactionHistoryRepository } from './JournalTransactionHistory';

type TransitionVerdict = 'APPLY' | 'REPLAY' | 'INVALID';

@singleton()
@autoInjectable()
export class JournalTransactionRepository {
  private readonly historyRepository: JournalTransactionHistoryRepository;
  private readonly bookPostingRepository: BookPostingRepository;

  constructor(historyRepository?: JournalTransactionHistoryRepository, bookPostingRepository?: BookPostingRepository) {
    this.historyRepository = historyRepository!;
    this.bookPostingRepository = bookPostingRepository!;
  }

  async findByTransactionHash(transactionHash: string, transaction: Transaction): Promise<JournalTransaction | null> {
    return JournalTransaction.findOne({ where: { transactionHash }, transaction });
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

  private evaluateTransition(currentStateId: number | null, targetStateId: number | undefined, sequence?: readonly number[]): TransitionVerdict {
    if (targetStateId == null) {
      return 'APPLY';
    }

    if (sequence) {
      const currentIndex = currentStateId != null ? sequence.indexOf(currentStateId) : -1;
      const targetIndex = sequence.indexOf(targetStateId);

      if (targetIndex !== -1 && targetIndex <= currentIndex) {
        return 'REPLAY';
      }

      return targetIndex === currentIndex + 1 ? 'APPLY' : 'INVALID';
    }

    if (currentStateId != null && (TRANSACTION_STATE_RANK[targetStateId] ?? -Infinity) <= (TRANSACTION_STATE_RANK[currentStateId] ?? -Infinity)) {
      return 'REPLAY';
    }

    return 'APPLY';
  }

  async updateJournalTransaction(params: UpdateJournalTransactionParams, transaction: Transaction): Promise<UpdateJournalTransactionResult> {
    const journalTransaction = await JournalTransaction.findByPk(params.journalTransactionId, { transaction, lock: transaction.LOCK.UPDATE });

    if (!journalTransaction) {
      throw new NotFoundError('JournalTransaction', params.journalTransactionId);
    }

    const currentStateId = await this.getCurrentTransactionStateId(journalTransaction.id, transaction);

    if (TERMINAL_JOURNAL_TRANSACTION_STATES.has(journalTransaction.journalTransactionState)) {
      return { journalTransaction, outcome: 'REPLAYED_NOOP', previousTransactionStateId: currentStateId, transactionStateId: currentStateId };
    }

    const verdict = this.evaluateTransition(currentStateId, params.targetTransactionStateId, params.expectedStateSequence);

    if (verdict === 'REPLAY') {
      return { journalTransaction, outcome: 'REPLAYED_NOOP', previousTransactionStateId: currentStateId, transactionStateId: currentStateId };
    }

    if (verdict === 'INVALID') {
      await this.save(journalTransaction, { journalTransactionState: JOURNAL_TRANSACTION_STATE.REJECTED }, params.updatedBy, transaction);
      await this.historyRepository.record(
        {
          journalTransaction,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.REJECTED_INVALID_TRANSITION,
          transactionStateId: currentStateId,
          createdBy: params.updatedBy,
        },
        transaction,
      );

      return {
        journalTransaction,
        outcome: 'REJECTED_INVALID_TRANSITION',
        previousTransactionStateId: currentStateId,
        transactionStateId: currentStateId,
      };
    }

    await this.save(
      journalTransaction,
      {
        transactionHash: params.transactionHash,
        journalTransactionState: params.journalTransactionState ?? journalTransaction.journalTransactionState,
      },
      params.updatedBy,
      transaction,
    );

    const newStateId = params.targetTransactionStateId ?? currentStateId;

    await this.historyRepository.record(
      {
        journalTransaction,
        historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
        transactionStateId: newStateId,
        createdBy: params.updatedBy,
      },
      transaction,
    );

    return { journalTransaction, outcome: 'APPLIED', previousTransactionStateId: currentStateId, transactionStateId: newStateId };
  }

  private async save(
    journalTransaction: JournalTransaction,
    changes: { transactionHash?: string; journalTransactionState: JournalTransaction['journalTransactionState'] },
    updatedBy: number | undefined,
    transaction: Transaction,
  ): Promise<void> {
    journalTransaction.transactionHash = journalTransaction.transactionHash ?? changes.transactionHash ?? null;
    journalTransaction.journalTransactionState = changes.journalTransactionState;
    journalTransaction.updatedDate = new Date();
    journalTransaction.updatedBy = updatedBy ?? null;

    await journalTransaction.save({ transaction });
  }
}
