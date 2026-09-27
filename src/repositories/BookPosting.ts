import { randomUUID } from 'crypto';
import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { BookPosting } from '../models';
import { BookRepository } from './Book';

/**
 * @autoInjectable(): tsyringe tự suy ra dependency (BookRepository) qua kiểu
 * TypeScript của tham số constructor, không cần khai báo @inject(...) thủ công.
 */
@singleton()
@autoInjectable()
export class BookPostingRepository {
  private readonly bookRepository: BookRepository;

  constructor(bookRepository?: BookRepository) {
    this.bookRepository = bookRepository!;
  }

  async createBookPosting(params: any, transaction: Transaction): Promise<BookPosting> {
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
        historyTransactionTypeId: params.historyTransactionTypeId,
        updatedBy: params.createdBy ?? null,
      },
      transaction,
    );

    return posting;
  }
}
