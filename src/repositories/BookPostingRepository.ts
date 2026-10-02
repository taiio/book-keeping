import { randomUUID } from 'crypto';
import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { IdempotencyConflictError } from '../common/errors';
import type { BookPostingPurposeId } from '../constants';
import { legItemFromBook } from '../helpers';
import { Book, BookPosting } from '../models';
import type { CreateBookPostingParams, Holding } from '../types';
import { BookRepository } from './BookRepository';

@singleton()
@autoInjectable()
export class BookPostingRepository {
  private readonly bookRepository: BookRepository;

  constructor(bookRepository?: BookRepository) {
    this.bookRepository = bookRepository!;
  }

  /**
   * Writes one posting, idempotently by token. Re-sending the same token with the same content is a no-op;
   * re-sending it with different content is a conflict (it would otherwise be silently swallowed).
   */
  async createBookPosting(params: CreateBookPostingParams, tx: Transaction): Promise<BookPosting> {
    const lockedBook = params.lockedBook ?? (await this.bookRepository.lockBookById(params.bookId, tx));
    const nextSequenceNo = Number(lockedBook.lastSequenceNo) + 1;

    const [posting, created] = await BookPosting.findOrCreate({
      where: { idempotencyToken: params.idempotencyToken },
      defaults: {
        uuidToken: randomUUID(),
        journalTransactionId: params.journalTransactionId,
        bookId: lockedBook.id,
        amount: params.amount,
        assetTypeId: params.assetTypeId,
        sequenceNo: nextSequenceNo,
        idempotencyToken: params.idempotencyToken,
        bookPostingPurposeId: params.bookPostingPurposeId,
        businessPostDateTime: params.businessPostDateTime,
        createdBy: params.createdBy ?? null,
      },
      transaction: tx,
    });

    if (!created) {
      this.assertSameContent(posting, params);
      return posting;
    }

    await this.bookRepository.updateBook(
      {
        book: lockedBook,
        amountDelta: params.amount,
        sequenceNo: nextSequenceNo,
        bookPostingId: posting.id,
        updatedBy: params.createdBy,
      },
      tx,
    );

    return posting;
  }

  /**
   * What a journal transaction currently holds, per book and purpose (sum of its postings on that book).
   * Only non-zero holdings are returned.
   */
  async findHoldings(journalTransactionId: number, tx: Transaction): Promise<Holding[]> {
    const postings = await BookPosting.findAll({
      where: { journalTransactionId },
      attributes: ['bookId', 'bookPostingPurposeId', 'amount'],
      transaction: tx,
    });

    const totals = new Map<string, { bookId: number; purpose: BookPostingPurposeId; amount: bigint }>();

    for (const posting of postings) {
      const key = `${posting.bookId}|${posting.bookPostingPurposeId}`;
      const total = totals.get(key) ?? { bookId: posting.bookId, purpose: posting.bookPostingPurposeId as BookPostingPurposeId, amount: 0n };

      total.amount += BigInt(posting.amount);
      totals.set(key, total);
    }

    if (totals.size === 0) return [];

    const books: Book[] = await Book.findAll({ where: { id: Array.from(new Set(Array.from(totals.values(), (total) => total.bookId))) }, transaction: tx });
    const bookById = new Map(books.map((book) => [book.id, book]));

    const holdings: Holding[] = [];

    for (const { bookId, purpose, amount } of totals.values()) {
      const book = bookById.get(bookId);

      if (!book || amount === 0n) continue;

      holdings.push({
        ref: { bookPurposeId: book.bookPurposeId, transactionStateId: book.transactionStateId },
        item: legItemFromBook(book),
        purpose,
        amount,
      });
    }

    return holdings;
  }

  private assertSameContent(existing: BookPosting, params: CreateBookPostingParams): void {
    const sameContent =
      existing.bookId === params.bookId &&
      existing.journalTransactionId === params.journalTransactionId &&
      existing.bookPostingPurposeId === params.bookPostingPurposeId &&
      BigInt(existing.amount) === BigInt(params.amount);

    if (!sameContent) {
      throw new IdempotencyConflictError(
        params.idempotencyToken,
        `existing(book=${existing.bookId}, amount=${existing.amount}) differs from incoming(book=${params.bookId}, amount=${params.amount})`,
      );
    }
  }
}
