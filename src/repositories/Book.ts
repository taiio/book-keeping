import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { Book, BookHistory } from '../models';
import { NotFoundError, InsufficientBalanceError } from '../common/errors';
import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';

@singleton()
@autoInjectable()
export class BookRepository {

  async findByDepositAddress(address: string, assetTicker: string, transaction: Transaction): Promise<Book | null> {
    return Book.findOne({ where: { address, assetTicker }, transaction });
  }

  async getOrCreateBook(params: any, transaction: Transaction): Promise<any> {
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

  async updateBook(params: any, transaction: Transaction): Promise<Book> {
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
        historyTransactionTypeId,
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
