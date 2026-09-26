import { randomUUID } from 'crypto';
import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { BookPosting } from '../models';
import { BookRepository } from './Book';
import type { CreateBookPostingParams } from './interfaces';

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

  /**
   * Tạo 1 bút toán (BookPosting) và áp dụng nó lên số dư Book tương ứng,
   * kèm ghi BookHistory. Idempotent theo params.idempotencyToken: gọi lại
   * với cùng token sẽ trả về posting đã tạo, KHÔNG cộng/trừ tiền lần 2 —
   * kể cả khi 2 lần gọi đến gần như đồng thời (duplicate event/webhook).
   *
   * ĐÂY LÀ CHỖ RACE CONDITION NGHIÊM TRỌNG NHẤT CỦA CODE CŨ:
   *
   * Code cũ làm theo thứ tự: (1) findOne theo idempotencyToken để check
   * trùng -> (2) NẾU CHƯA CÓ thì mới lockBookById -> (3) insert posting ->
   * (4) cộng/trừ Book.amount.
   *
   * Vấn đề: bước (1) chạy trước khi có bất kỳ lock nào tồn tại. Với 2 lần
   * gọi trùng idempotencyToken đến gần như đồng thời (A và B), cả 2 đều có
   * thể findOne ra "chưa tồn tại" (vì chưa ai insert/commit), rồi CẢ HAI
   * cùng đi tiếp xuống lockBookById: A khoá được book trước, B phải đợi.
   * A insert posting + cộng tiền + commit + nhả lock. B được cấp lock,
   * nhưng B đã "biết" từ bước (1) là "chưa tồn tại" nên B vẫn insert posting
   * và cộng tiền THÊM MỘT LẦN NỮA — tiền bị áp dụng 2 lần cho cùng 1 event,
   * mà việc này còn tệ hơn cả unique constraint bị vi phạm, vì
   * book_posting.idempotency_token trong code cũ KHÔNG HỀ có unique index
   * ở DB (đã bổ sung ở model), nên INSERT thứ 2 không hề bị chặn — nó
   * chạy trót lọt và ghi đè luôn số dư sai.
   *
   * Cách sửa — đảo thứ tự + dựa vào unique constraint DB:
   *   (1) Lock book TRƯỚC (SELECT ... FOR UPDATE). Điều này tự động
   *       serialize hoá mọi lần gọi cho CÙNG 1 book: B phải đợi A xong
   *       hẳn (bao gồm cả việc A đã insert xong posting và commit) rồi mới
   *       được cấp lock.
   *   (2) Sau khi có lock, mới findOrCreate posting theo idempotencyToken
   *       (được bảo vệ bởi unique index `uk_book_posting_idempotency_token`
   *       ở DB). Nếu A đã insert trước đó, lúc B chạy tới đây B sẽ THẤY
   *       posting đã tồn tại (created = false) vì A đã lock+insert+cộng
   *       tiền xong trước khi nhả lock cho B — B trả về posting cũ, không
   *       cộng/trừ tiền lần 2.
   *
   * Lưu ý: unique constraint vẫn là lớp phòng thủ cuối cùng ngay cả trong
   * trường hợp hiếm gặp 2 posting trùng idempotencyToken nhắm vào 2 book
   * khác nhau (lock ở bước (1) không giúp được gì khi 2 book khác nhau) —
   * `findOrCreate` sẽ tự rollback-về-savepoint và trả lại bản ghi đã tồn
   * tại thay vì để lỗi unique constraint làm vỡ transaction.
   */
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
      // Duplicate event: posting này đã được áp dụng trước đó (có thể bởi
      // 1 request đang chờ lock ngay phía trước ta, hoặc từ 1 lần retry
      // trước). Trả về nguyên trạng — TUYỆT ĐỐI không gọi updateBook lần 2.
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
