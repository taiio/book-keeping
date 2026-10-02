import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { InsufficientBalanceError, NotFoundError } from '../common/errors';
import { BOOK_PURPOSE, HISTORY_EVENT_TYPE, TRANSACTION_STATE } from '../constants';
import { Book } from '../models';
import type { BookParams, GetOrCreateBookResult, UpdateBookParams } from '../types';
import { BookHistoryRepository } from './BookHistoryRepository';

@singleton()
@autoInjectable()
export class BookRepository {
  private readonly bookHistoryRepository: BookHistoryRepository;

  constructor(bookHistoryRepository?: BookHistoryRepository) {
    this.bookHistoryRepository = bookHistoryRepository!;
  }

  async findBook(params: BookParams, tx: Transaction): Promise<Book | null> {
    return Book.findOne({ where: this.bookKey(params), transaction: tx });
  }

  async getOrCreateBook(params: BookParams, tx: Transaction): Promise<GetOrCreateBookResult> {
    const [book, created] = await Book.findOrCreate({
      where: this.bookKey(params),
      defaults: {
        name: params.name,
        assetId: params.assetId,
        assetTicker: params.assetTicker,
        address: params.address ?? null,
        amount: '0',
        lastSequenceNo: 0,
        createdBy: params.createdBy ?? null,
      },
      transaction: tx,
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
        tx,
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

  async lockBooksInOrder(bookIds: number[], tx: Transaction): Promise<Map<number, Book>> {
    const uniqueSortedIds = Array.from(new Set(bookIds)).sort((a, b) => a - b);
    const result = new Map<number, Book>();

    for (const id of uniqueSortedIds) {
      result.set(id, await this.lockBookById(id, tx));
    }

    return result;
  }

  async updateBook(params: UpdateBookParams, tx: Transaction): Promise<Book> {
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

    await book.save({ transaction: tx });

    await this.bookHistoryRepository.record(
      {
        historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
        bookId: book.id,
        bookPostingId: bookPostingId ?? null,
        amount: book.amount,
        lastSequenceNo: sequenceNo,
        createdBy: updatedBy,
      },
      tx,
    );

    return book;
  }

  bookKey(params: BookParams) {
    return {
      clientId: params.clientId,
      accountId: params.accountId,
      assetTypeId: params.assetTypeId,
      walletTypeId: params.walletTypeId,
      bookPurposeId: params.bookPurposeId,
      transactionStateId: params.transactionStateId,
    };
  }
}
