import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { Book, BookHistory } from '../models';
import { NotFoundError, InsufficientBalanceError } from '../common/errors';
import type { UpdateBookParams } from './interfaces';
import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';

@singleton()
@autoInjectable()
export class BookRepository {
  async getOrCreateBook(params: any, transaction: Transaction): Promise<Book> {
    const existing = await Book.findOne({
      where: {
        clientId: params.clientId,
        accountId: params.accountId,
        assetTypeId: params.assetTypeId,
        walletTypeId: params.walletTypeId,
        bookPurposeId: params.bookPurposeId,
        name: params.name,
        transactionStateId: params.transactionStateId,
      },
      transaction,
    });

    if (existing) {
      return existing;
    }

    const book = await Book.create({ ...params, amount: '0' }, { transaction });

    return book;
  }

  /** SELECT ... FOR UPDATE — book row là điểm serialize hoá mọi posting ghi vào nó. */

  async lockBookById(bookId: number, tx: Transaction): Promise<Book> {
    const book = await Book.findByPk(bookId, { transaction: tx, lock: tx.LOCK.UPDATE });

    if (!book) {
      throw new NotFoundError('Book', bookId);
    }

    return book;
  }

  /**
   * Áp dụng thay đổi số dư lên 1 book ĐÃ khoá, đồng thời ghi 1 dòng BookHistory
   * (snapshot số dư sau khi áp dụng). Đây là nơi duy nhất được phép sửa Book.amount.
   */
  async updateBook(params: UpdateBookParams, transaction: Transaction): Promise<Book> {
    const { book, amountDelta, sequenceNo, bookPostingId, transactionStateId, historyTransactionTypeId, updatedBy } = params;

    const currentAmount = BigInt(book.amount ?? '0');
    const delta = BigInt(amountDelta);
    const nextAmount = currentAmount + delta;

    if (
      nextAmount < 0n &&
      book.bookPurposeId === BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id &&
      book.transactionStateId === TRANSACTION_STATE.CONFIRMED.id
    ) {
      throw new InsufficientBalanceError(book.id, book.amount, amountDelta);
    }

    book.amount = nextAmount.toString();
    book.lastSequenceNo = sequenceNo || 1;

    if (transactionStateId !== undefined) {
      book.transactionStateId = transactionStateId;
    }

    book.updatedDate = new Date();
    book.updatedBy = updatedBy ?? null;

    await book.save({ transaction });

    await BookHistory.create(
      {
        historyTransactionTypeId: 1,
        bookId: book.id,
        bookPostingId: bookPostingId ?? null,
        amount: book.amount,
        lastSequenceNo: sequenceNo,
        createdBy: updatedBy ?? null,
      },
      { transaction },
    );

    return book;
  }
}
