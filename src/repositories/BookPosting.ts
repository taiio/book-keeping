import { randomUUID } from 'crypto';
import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { CreateBookPostingParams } from '../interfaces';
import { Book, BookPosting } from '../models';
import { BookRepository } from './Book';

@singleton()
@autoInjectable()
export class BookPostingRepository {
  private readonly bookRepository: BookRepository;

  constructor(bookRepository?: BookRepository) {
    this.bookRepository = bookRepository!;
  }

  async createBookPosting(params: CreateBookPostingParams, transaction: Transaction): Promise<BookPosting> {
    const lockedBook = await this.bookRepository.lockBookById(params.bookId, transaction);
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
      transaction,
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
      transaction,
    );

    return posting;
  }

  async countByJournalTransactionId(journalTransactionId: number, transaction: Transaction): Promise<number> {
    return BookPosting.count({ where: { journalTransactionId }, transaction });
  }

  async findLatestTransactionStateId(journalTransactionId: number, transaction: Transaction): Promise<number | null> {
    const latestPosting = await BookPosting.findOne({ where: { journalTransactionId }, order: [['id', 'DESC']], transaction });

    if (!latestPosting) {
      return null;
    }

    const book = await Book.findByPk(latestPosting.bookId, { transaction });

    return book?.transactionStateId ?? null;
  }
}
