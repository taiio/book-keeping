import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { InsufficientBalanceError, NotFoundError } from '../common/errors';
import { BOOK_PURPOSE, HISTORY_EVENT_TYPE, TRANSACTION_STATE } from '../constants';
import { BookLegParams, GetOrCreateBookResult, UpdateBookParams } from '../interfaces';
import { Book } from '../models';
import { BookHistoryRepository } from './BookHistory';

@singleton()
@autoInjectable()
export class BookRepository {
  private readonly bookHistoryRepository: BookHistoryRepository;

  constructor(bookHistoryRepository?: BookHistoryRepository) {
    this.bookHistoryRepository = bookHistoryRepository!;
  }

  async findByDepositAddress(address: string, assetTicker: string, transaction: Transaction): Promise<Book | null> {
    return Book.findOne({ where: { address, assetTicker }, transaction });
  }

  /**
   * Get-or-create theo unique index của Book. Book mới tạo ra được ghi ngay 1 dòng
   * `book_history` (CREATED, amount = 0) để lịch sử của book luôn có điểm bắt đầu.
   */
  async getOrCreateBook(params: BookLegParams, transaction: Transaction): Promise<GetOrCreateBookResult> {
    const [book, created] = await Book.findOrCreate({
      where: {
        clientId: params.clientId,
        accountId: params.accountId,
        assetTypeId: params.assetTypeId,
        walletTypeId: params.walletTypeId,
        bookPurposeId: params.bookPurposeId,
        transactionStateId: params.transactionStateId,
      },
      defaults: {
        name: params.name,
        assetId: params.assetId,
        assetTicker: params.assetTicker,
        address: params.address ?? null,
        amount: '0',
        lastSequenceNo: 0,
        createdBy: params.createdBy ?? null,
      },
      transaction,
    });

    if (created) {
      await this.bookHistoryRepository.record(
        {
          historyTransactionTypeId: HISTORY_EVENT_TYPE.CREATED,
          bookId: book.id,
          bookPostingId: null,
          amount: book.amount,
          lastSequenceNo: book.lastSequenceNo,
          createdBy: params.createdBy,
        },
        transaction,
      );
    }

    return { book, created };
  }

  async lockBookById(bookId: number, tx: Transaction): Promise<Book> {
    const book = await Book.findByPk(bookId, { transaction: tx, lock: tx.LOCK.UPDATE });

    if (!book) {
      throw new NotFoundError('Book', bookId);
    }

    return book;
  }

  /** Khoá nhiều book theo thứ tự id tăng dần — bắt buộc để tránh deadlock khi nhiều transaction khoá chéo nhau. */
  async lockBooksInOrder(bookIds: number[], tx: Transaction): Promise<Map<number, Book>> {
    const uniqueSortedIds = Array.from(new Set(bookIds)).sort((a, b) => a - b);
    const result = new Map<number, Book>();

    for (const id of uniqueSortedIds) {
      result.set(id, await this.lockBookById(id, tx));
    }

    return result;
  }

  /**
   * Cập nhật số dư Book + ghi `book_history` (POSTING_APPLIED) trong cùng transaction.
   * `book` PHẢI là bản ghi đã khoá. Chỉ book CUSTODY ở bucket CONFIRMED (available) mới
   * không được âm; các bucket trung gian (AUTHORIZING) và external được phép âm/dương tự do.
   */
  async updateBook(params: UpdateBookParams, transaction: Transaction): Promise<Book> {
    const { book, amountDelta, sequenceNo, bookPostingId, updatedBy } = params;

    const nextAmount = BigInt(book.amount ?? '0') + BigInt(amountDelta);

    if (
      nextAmount < 0n &&
      book.bookPurposeId === BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id &&
      book.transactionStateId === TRANSACTION_STATE.CONFIRMED.id
    ) {
      throw new InsufficientBalanceError(book.id, book.amount, amountDelta);
    }

    book.amount = nextAmount.toString();
    book.lastSequenceNo = sequenceNo;
    book.updatedDate = new Date();
    book.updatedBy = updatedBy ?? null;

    await book.save({ transaction });

    await this.bookHistoryRepository.record(
      {
        historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
        bookId: book.id,
        bookPostingId: bookPostingId ?? null,
        amount: book.amount,
        lastSequenceNo: sequenceNo,
        createdBy: updatedBy,
      },
      transaction,
    );

    return book;
  }
}
