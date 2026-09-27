import { Transaction } from 'sequelize';

import { Book, BookPosting } from '../../models';
import { NotFoundError } from '../../common/errors';

/**
 * Tìm book đã tham gia vào 1 journal transaction, theo bookPurposeId, thông
 * qua BookPosting đã tạo trước đó — dùng bookId (khoá ngoại thật) thay vì
 * suy đoán qua field "name" tự do.
 *
 * Khi 1 flow di chuyển số dư qua nhiều bucket theo state (vd withdraw:
 * AUTHORIZING -> AUTHORIZED -> SENT -> ...), có thể có NHIỀU BookPosting
 * cùng bookPurposeId nhưng khác book (mỗi bucket state là 1 Book row riêng —
 * xem idx_unique_book). Mặc định lấy posting MỚI NHẤT (order by id DESC) để
 * luôn trỏ đúng bucket hiện tại; truyền `atTransactionStateId` khi cần trỏ
 * đích danh 1 bucket cụ thể (vd lúc hoàn tiền, cần đúng bucket đang treo
 * tiền, không phải bucket mới nhất nếu có sự kiện chen ngang).
 */
export async function findBookByJournalAndPurpose(
  journalTransactionId: number,
  bookPurposeId: number,
  transaction: Transaction,
  atTransactionStateId?: number | null,
  bookPostingPurposeId?: number,
): Promise<Book> {
  const posting = await BookPosting.findOne({
    where: {
      journalTransactionId,
      ...(bookPostingPurposeId != null ? { bookPostingPurposeId } : {}),
    },
    include: [
      {
        association: 'book',
        required: true,
        where: atTransactionStateId != null ? { bookPurposeId, transactionStateId: atTransactionStateId } : { bookPurposeId },
      },
    ],
    order: [['id', 'DESC']],
    transaction,
  });

  if (!posting || !posting.book) {
    const purposeSuffix = bookPostingPurposeId != null ? `:${bookPostingPurposeId}` : '';
    throw new NotFoundError(
      'Book (journal leg)',
      `${journalTransactionId}:${bookPurposeId}${atTransactionStateId != null ? `@${atTransactionStateId}` : ''}${purposeSuffix}`,
    );
  }

  return posting.book;
}
