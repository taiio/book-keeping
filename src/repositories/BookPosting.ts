import { randomUUID } from 'crypto';
import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { CreateBookPostingParams } from '../interfaces';
import { BookPosting } from '../models';
import { BookRepository } from './Book';

/**
 * Tạo BookPosting (idempotent theo `idempotencyToken`) và kéo theo update Book +
 * `book_history` (qua BookRepository.updateBook). Gọi lại cùng token là no-op.
 */
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
}
