import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { RecordJournalTransactionHistoryParams } from '../interfaces';
import { JournalTransactionHistory } from '../models';

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
        transactionStateId: params.transactionStateId ?? null,
        createdBy: params.createdBy ?? null,
      },
      { transaction },
    );
  }

  async findLatest(journalTransactionId: number, transaction: Transaction): Promise<JournalTransactionHistory | null> {
    return JournalTransactionHistory.findOne({ where: { journalTransactionId }, order: [['id', 'DESC']], transaction });
  }
}
