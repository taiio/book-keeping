import { Transaction } from 'sequelize';

import { Book, BookPosting } from '../../models';
import { BookPostingRepository } from '../../repositories';
import { buildPostingIdempotencyToken } from './idempotency';

/**
 * Tham số cho 1 cặp bút toán đối ứng (double-entry): `fromBook` bị trừ
 * `amount`, `toBook` được cộng đúng `amount` — luôn trong cùng 1
 * journalTransaction, cùng 1 assetTypeId, cùng 1 bookPostingPurposeId.
 *
 * Đây CHÍNH LÀ khối logic đã bị copy-paste ở mọi flow trong code cũ (rõ nhất
 * là WithdrawFlow.ts: xuất hiện y hệt ở create(), moveBucket() và
 * refundBucketToClient() — chỉ khác book/amount/token). Gom về đây để:
 *   - Mọi flow tạo bút toán kép theo ĐÚNG 1 cách duy nhất (không lệch nhau
 *     do sửa ở chỗ này quên sửa chỗ kia).
 *   - Muốn đổi cách sinh token / thêm audit field... chỉ sửa 1 nơi.
 */
export interface PostDoubleEntryParams {
  journalTransactionId: number;
  fromBook: Book;
  toBook: Book;
  /** Số tiền chuyển, LUÔN là số dương (magnitude) — fromBook nhận -amount, toBook nhận +amount. */
  amount: string;
  assetTypeId: number;
  bookPostingPurposeId: number;
  historyTransactionTypeId: number;
  createdBy?: number | null;
  businessPostDateTime: Date;

  /** Token gốc dùng để suy ra token của từng leg (xem buildPostingIdempotencyToken). */
  idempotencyToken: string;
  transactionTypeId: number;
  /**
   * "state" dùng trong công thức token — đại diện cho BƯỚC nghiệp vụ hiện
   * tại (không nhất thiết trùng transactionStateId thật của từng book, xem
   * DepositFlow.create() — cả 2 leg cùng dùng CONFIRMING dù book EXTERNAL
   * có transactionStateId = null).
   */
  tokenStateId: number | null;
  /**
   * Lệch offset cho legIndex — mặc định 0 (leg 1/2). Dùng offset 900 cho
   * nhánh hoàn tiền (refund) để token KHÔNG BAO GIỜ trùng với token của các
   * bước advance bình thường trên cùng book/state (xem WithdrawFlow.refund).
   */
  legIndexOffset?: number;
}

export interface PostDoubleEntryResult {
  fromPosting: BookPosting;
  toPosting: BookPosting;
}

export async function postDoubleEntry(
  bookPostingRepository: BookPostingRepository,
  params: PostDoubleEntryParams,
  transaction: Transaction,
): Promise<PostDoubleEntryResult> {
  const legIndexOffset = params.legIndexOffset ?? 0;

  const fromToken = buildPostingIdempotencyToken({
    idempotencyToken: params.idempotencyToken,
    transactionTypeId: params.transactionTypeId,
    transactionStateId: params.tokenStateId,
    bookPostingPurposeId: params.bookPostingPurposeId,
    legIndex: legIndexOffset + 1,
  });
  const toToken = buildPostingIdempotencyToken({
    idempotencyToken: params.idempotencyToken,
    transactionTypeId: params.transactionTypeId,
    transactionStateId: params.tokenStateId,
    bookPostingPurposeId: params.bookPostingPurposeId,
    legIndex: legIndexOffset + 2,
  });

  const fromPosting = await bookPostingRepository.createBookPosting(
    {
      bookId: params.fromBook.id,
      journalTransactionId: params.journalTransactionId,
      amount: `-${params.amount}`,
      assetTypeId: params.assetTypeId,
      bookPostingPurposeId: params.bookPostingPurposeId,
      idempotencyToken: fromToken,
      historyTransactionTypeId: params.historyTransactionTypeId,
      createdBy: params.createdBy,
      businessPostDateTime: params.businessPostDateTime,
    },
    transaction,
  );

  const toPosting = await bookPostingRepository.createBookPosting(
    {
      bookId: params.toBook.id,
      journalTransactionId: params.journalTransactionId,
      amount: params.amount,
      assetTypeId: params.assetTypeId,
      bookPostingPurposeId: params.bookPostingPurposeId,
      idempotencyToken: toToken,
      historyTransactionTypeId: params.historyTransactionTypeId,
      createdBy: params.createdBy,
      businessPostDateTime: params.businessPostDateTime,
    },
    transaction,
  );

  return { fromPosting, toPosting };
}

/**
 * Base idempotency token cho các thao tác "hậu tạo" trên 1 journal đã tồn
 * tại (advance/unstake/refund) — khi request không nhất thiết mang lại
 * idempotencyToken gốc, rơi về `journalTransaction.idempotencyToken`, hoặc
 * nếu null (journal được tạo không kèm token), dùng `journal-{id}` làm gốc
 * xác định (deterministic theo journal đó).
 */
export function resolveBaseIdempotencyToken(journalTransaction: { id: number; idempotencyToken: string | null }): string {
  return journalTransaction.idempotencyToken ?? `journal-${journalTransaction.id}`;
}
