import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { RecordJournalTransactionHistoryParams } from '../interfaces';
import { JournalTransactionHistory } from '../models';

/**
 * Nơi DUY NHẤT ghi `journal_transaction_history`. Mỗi dòng là 1 snapshot của
 * JournalTransaction TẠI THỜI ĐIỂM sự kiện xảy ra (state chi tiết, state tổng, hash) —
 * không phải cache, nên không đổi khi journal tiến tiếp sau đó.
 */
@singleton()
@autoInjectable()
export class JournalTransactionHistoryRepository {
  async record(params: RecordJournalTransactionHistoryParams, transaction: Transaction): Promise<JournalTransactionHistory> {
    const { journalTransaction } = params;

    return JournalTransactionHistory.create(
      {
        historyTransactionTypeId: params.historyTransactionTypeId,
        journalTransactionId: journalTransaction.id,
        transactionHash: journalTransaction.transactionHash,
        journalTransactionState: journalTransaction.journalTransactionState,
        transactionStateId: journalTransaction.transactionStateId,
        createdBy: params.createdBy ?? null,
      },
      { transaction },
    );
  }

  async findLatest(journalTransactionId: number, transaction: Transaction): Promise<JournalTransactionHistory | null> {
    return JournalTransactionHistory.findOne({ where: { journalTransactionId }, order: [['id', 'DESC']], transaction });
  }
}
