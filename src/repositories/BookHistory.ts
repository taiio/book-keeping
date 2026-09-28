import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { RecordBookHistoryParams } from '../interfaces';
import { BookHistory } from '../models';

/**
 * Nơi DUY NHẤT ghi `book_history`. Mỗi dòng là 1 snapshot số dư của Book sau 1 sự kiện:
 *   - CREATED: book vừa được tạo (amount = 0, không có posting).
 *   - POSTING_APPLIED: 1 BookPosting vừa được áp vào book (liên kết qua book_posting_id).
 */
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
