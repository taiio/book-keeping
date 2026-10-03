import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { BookHistory } from '../models';
import type { RecordBookHistoryParams } from '../types';
import { SORT_DIRECTION } from '../constants';

@singleton()
@autoInjectable()
export class BookHistoryRepository {
  async record(params: RecordBookHistoryParams, tx: Transaction): Promise<BookHistory> {
    return BookHistory.create(
      {
        historyTransactionTypeId: params.historyTransactionTypeId,
        bookId: params.bookId,
        bookPostingId: params.bookPostingId ?? null,
        amount: params.amount,
        lastSequenceNo: params.lastSequenceNo,
        createdBy: params.createdBy ?? null,
      },
      { transaction: tx },
    );
  }

  async findLatest(bookId: number, tx: Transaction): Promise<BookHistory | null> {
    return BookHistory.findOne({ where: { bookId }, order: [['id', SORT_DIRECTION.DESC]], transaction: tx });
  }
}
