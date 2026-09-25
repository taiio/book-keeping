import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { BookPosting } from '../models';
import { BookRepository } from './Book';
import type { CreateBookPostingParams } from './interfaces';

/**
 * @autoInjectable(): tsyringe tự suy ra dependency (BookRepository) qua kiểu
 * TypeScript của tham số constructor, không cần khai báo @inject(...) thủ công.
 * Nhờ vậy vừa dùng được `container.resolve(BookPostingRepository)`, vừa dùng
 * được `new BookPostingRepository()` (tự động nhận BookRepository).
 */
@singleton()
@autoInjectable()
export class BookPostingRepository {
  private readonly bookRepository: BookRepository;

  constructor(bookRepository?: BookRepository) {
    this.bookRepository = bookRepository!;
  }

  /**
   * Tạo 1 bút toán (BookPosting) và áp dụng nó lên số dư Book tương ứng,
   * kèm ghi BookHistory. Idempotent theo params.idempotencyToken: gọi lại
   * với cùng token sẽ trả về posting đã tạo, không cộng/trừ tiền lần 2.
   */
  async createBookPosting(params: CreateBookPostingParams, transaction: Transaction): Promise<BookPosting> {
    const existing = await BookPosting.findOne({ where: { idempotencyToken: params.idempotencyToken }, transaction });

    if (existing) {
      return existing;
    }

    const lockedBook = await this.bookRepository.lockBookById(params.bookId, transaction);
    const nextSequenceNo = Number(lockedBook.lastSequenceNo) + 1;

    const posting = await BookPosting.create(
      {
        uuidToken: crypto.randomUUID(),
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
      { transaction },
    );

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
