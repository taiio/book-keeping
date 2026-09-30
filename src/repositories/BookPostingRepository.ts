import { randomUUID } from 'crypto';
import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { Book, BookPosting } from '../models';
import type { CreateBookPostingParams } from '../types';
import { BookRepository } from './BookRepository';

@singleton()
@autoInjectable()
export class BookPostingRepository {
  private readonly bookRepository: BookRepository;

  constructor(bookRepository?: BookRepository) {
    this.bookRepository = bookRepository!;
  }

  async createBookPosting(params: CreateBookPostingParams, tx: Transaction): Promise<BookPosting> {
    const lockedBook = await this.bookRepository.lockBookById(params.bookId, tx);
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

  async findLatestTransactionStateId(journalTransactionId: number, tx: Transaction): Promise<number | null> {
    const latestPosting = await BookPosting.findOne({ where: { journalTransactionId }, order: [['id', 'DESC']], transaction: tx });

    if (!latestPosting) {
      return null;
    }

    const book = await Book.findByPk(latestPosting.bookId, { transaction: tx });

    return book?.transactionStateId ?? null;
  }
}
