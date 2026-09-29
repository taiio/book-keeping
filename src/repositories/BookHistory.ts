import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { RecordBookHistoryParams } from '../interfaces';
import { BookHistory } from '../models';

@singleton()
@autoInjectable()
export class BookHistoryRepository {
  async record(params: RecordBookHistoryParams, transaction: Transaction): Promise<BookHistory> {
    return BookHistory.create(
      {
        historyTransactionTypeId: params.historyTransactionTypeId,
        bookId: params.bookId,
        bookPostingId: params.bookPostingId ?? null,
        amount: params.amount,
        lastSequenceNo: params.lastSequenceNo,
        createdBy: params.createdBy ?? null,
      },
      { transaction },
    );
  }

  async findLatest(bookId: number, transaction: Transaction): Promise<BookHistory | null> {
    return BookHistory.findOne({ where: { bookId }, order: [['id', 'DESC']], transaction });
  }
}
