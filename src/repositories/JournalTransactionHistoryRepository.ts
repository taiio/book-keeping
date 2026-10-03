import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { JournalTransactionHistory } from '../models';
import type { RecordJournalTransactionHistoryParams } from '../types';
import { SORT_DIRECTION } from '../constants';

@singleton()
@autoInjectable()
export class JournalTransactionHistoryRepository {
  async record(params: RecordJournalTransactionHistoryParams, tx: Transaction): Promise<JournalTransactionHistory> {
    const { journalTransaction } = params;

    return JournalTransactionHistory.create(
      {
        historyTransactionTypeId: params.historyTransactionTypeId,
        journalTransactionId: journalTransaction.id,
        transactionHash: journalTransaction.transactionHash,
        journalTransactionState: journalTransaction.journalTransactionState,
        transactionStateId: params.transactionStateId ?? null,
        createdBy: params.createdBy ?? null,
      },
      { transaction: tx },
    );
  }

  async findLatest(journalTransactionId: number, tx: Transaction): Promise<JournalTransactionHistory | null> {
    return JournalTransactionHistory.findOne({ where: { journalTransactionId }, order: [['id', SORT_DIRECTION.DESC]], transaction: tx });
  }
}
