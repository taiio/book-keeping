import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { JournalTransaction, JournalTransactionHistory } from '../models';
import { NotFoundError } from '../common/errors';
import type { GetOrCreateJournalTransactionParams, UpdateJournalTransactionParams } from './interfaces';
import { JOURNAL_TRANSACTION_STATE } from '../constants';

@singleton()
@autoInjectable()
export class JournalTransactionRepository {
  async getOrCreateJournalTransaction(params: GetOrCreateJournalTransactionParams, transaction: Transaction): Promise<JournalTransaction> {
    const existing = await JournalTransaction.findOne({ where: { idempotencyToken: params.idempotencyToken }, transaction });

    if (existing) {
      return existing;
    }

    const journalTransaction = await JournalTransaction.create(
      {
        uuidToken: params.uuidToken,
        transactionTypeId: params.transactionTypeId,
        fromAccountId: params.fromAccountId ?? null,
        toAccountId: params.toAccountId ?? null,
        transactionHash: params.transactionHash ?? null,
        idempotencyToken: params.idempotencyToken,
        journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
        createdBy: params.createdBy ?? null,
      },
      { transaction },
    );

    await JournalTransactionHistory.create(
      {
        historyTransactionTypeId: params.historyTransactionTypeId,
        journalTransactionId: journalTransaction.id,
        transactionHash: params.transactionHash ?? null,
        journalTransactionState: params.journalTransactionState,
        createdBy: params.createdBy ?? null,
      },
      { transaction },
    );

    return journalTransaction;
  }

  /** State hiện tại (theo lịch sử mới nhất), dùng để kiểm tra tính đơn điệu trước khi advance. */

  async getLatestStateId(journalTransactionId: number, transaction: Transaction): Promise<string | null> {
    const latest = await JournalTransactionHistory.findOne({ where: { journalTransactionId }, order: [['id', 'DESC']], transaction });

    return latest?.journalTransactionState ?? null;
  }

  /**
   * Chuyển trạng thái JournalTransaction. Đơn điệu (monotonic): nếu targetStateId
   * <= state hiện tại thì coi là replay/late-event, trả về journal không đổi.
   */
  async updateJournalTransaction(params: UpdateJournalTransactionParams, transaction: Transaction): Promise<JournalTransaction> {
    const journalTransaction = await JournalTransaction.findByPk(params.journalTransactionId, { transaction, lock: transaction.LOCK.UPDATE });

    if (!journalTransaction) {
      throw new NotFoundError('JournalTransaction', params.journalTransactionId);
    }

    const currentStateId = await this.getLatestStateId(journalTransaction.id, transaction);

    journalTransaction.transactionHash = params.transactionHash ?? journalTransaction.transactionHash ?? null;

    if (params.completeJournal) {
      journalTransaction.journalTransactionState = JOURNAL_TRANSACTION_STATE.COMPLETED;
    } else if (params.cancelJournal) {
      journalTransaction.journalTransactionState = JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED;
    }

    journalTransaction.updatedDate = new Date();
    journalTransaction.updatedBy = params.updatedBy ?? null;

    await journalTransaction.save({ transaction });

    await JournalTransactionHistory.create(
      {
        historyTransactionTypeId: params.historyTransactionTypeId,
        journalTransactionId: journalTransaction.id,
        transactionHash: journalTransaction.transactionHash,
        journalTransactionState: params.journalTransactionState,
        createdBy: params.updatedBy ?? null,
      },
      { transaction },
    );

    return journalTransaction;
  }
}
