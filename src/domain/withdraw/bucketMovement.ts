import { Transaction } from 'sequelize';

import { JournalTransaction } from '../../models';
import { BookRepository, BookPostingRepository } from '../../repositories';
import { BOOK_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE, HISTORY_EVENT_TYPE, BOOK_POSTING_PURPOSE } from '../../constants';
import { openBook, assetDescriptorOfBook } from '../shared/bookAccess';
import { postDoubleEntry, resolveBaseIdempotencyToken } from '../shared/doubleEntryPosting';
import { findBookByJournalAndPurpose } from '../shared/bookLookup';

export interface BucketMovementDeps {
  bookRepository: BookRepository;
  bookPostingRepository: BookPostingRepository;
}

/**
 * Di chuyển TOÀN BỘ số dư hiện có của 1 book "control/pass-through" (đại
 * diện qua bookPurposeId) từ bucket state CŨ sang bucket state MỚI — 2
 * posting đối ứng (debit bucket cũ, credit bucket mới). Dùng amount = số dư
 * THỰC TẾ đang có ở bucket cũ (không dùng lại request.amount gốc) để tổng
 * quát đúng ngay cả khi có nhiều lần cộng dồn vào bucket đó.
 */
export async function moveBucket(
  deps: BucketMovementDeps,
  journalTransaction: JournalTransaction,
  fromBookPurposeId: number,
  toBookPurposeId: number,
  bookPostingPurposeId: number,
  fromStateId: number,
  toStateId: number | null,
  updatedBy: number | null | undefined,
  transaction: Transaction,
): Promise<void> {
  const fromBook = await findBookByJournalAndPurpose(journalTransaction.id, fromBookPurposeId, transaction, fromStateId, bookPostingPurposeId);

  const toBookUnlocked = await openBook(
    deps.bookRepository,
    {
      code: toBookPurposeId === BOOK_PURPOSE.EXTERNAL_ACCOUNT.id ? BOOK_PURPOSE.EXTERNAL_ACCOUNT.code : (fromBook.name ?? String(toBookPurposeId)),
      bookPurposeId: toBookPurposeId,
      transactionStateId: toStateId,
      asset: assetDescriptorOfBook(fromBook),
      createdBy: updatedBy ?? null,
    },
    transaction,
  );

  const locked = await deps.bookRepository.lockBooksInOrder([fromBook.id, toBookUnlocked.id], transaction);
  const lockedFromBook = locked.get(fromBook.id)!;
  const lockedToBook = locked.get(toBookUnlocked.id)!;

  await postDoubleEntry(
    deps.bookPostingRepository,
    {
      journalTransactionId: journalTransaction.id,
      fromBook: lockedFromBook,
      toBook: lockedToBook,
      amount: lockedFromBook.amount,
      assetTypeId: lockedFromBook.assetTypeId,
      bookPostingPurposeId,
      historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
      createdBy: updatedBy,
      businessPostDateTime: new Date(),
      idempotencyToken: resolveBaseIdempotencyToken(journalTransaction),
      transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
      tokenStateId: toStateId,
    },
    transaction,
  );
}

/**
 * Hoàn tiền lại cho client khi 1 advance() bị REJECT vì sai thứ tự state.
 * Tìm book EXTERNAL_ACCOUNT (amount) + CUSTODY_ASSET_ACCOUNT (fee) tại
 * ĐÚNG bucket cuối cùng còn hợp lệ (journalTransaction.transactionStateId —
 * KHÔNG bị updateJournalTransaction ghi đè khi reject), rồi chuyển thẳng số
 * dư đang treo ở đó về lại CUSTODY_ASSET_ACCOUNT(CONFIRMED).
 *
 * Idempotent tự nhiên: hàm này chỉ được advance() gọi ĐÚNG 1 LẦN cho mỗi
 * journal (lần rejection ĐẦU TIÊN) — mọi lệnh advance() sai thứ tự gọi lại
 * SAU đó đều bị chặn sớm bởi TERMINAL_STATES (journal đã CANCELLED) và trả
 * về REPLAYED_NOOP trước khi tới được nhánh gọi hàm này.
 */
export async function refundFromLastValidBucket(
  deps: BucketMovementDeps,
  journalTransaction: JournalTransaction,
  updatedBy: number | null | undefined,
  transaction: Transaction,
): Promise<void> {
  const lastValidStateId = journalTransaction.transactionStateId;

  if (lastValidStateId == null) {
    // Không nên xảy ra trong thực tế (create() luôn set AUTHORIZING ngay
    // từ đầu) — không có bucket nào để hoàn thì không có gì để làm.
    return;
  }

  await refundBucketToClient(
    deps,
    journalTransaction,
    BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
    BOOK_POSTING_PURPOSE.AMOUNT,
    lastValidStateId,
    updatedBy,
    transaction,
  );
  await refundBucketToClient(
    deps,
    journalTransaction,
    BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
    BOOK_POSTING_PURPOSE.FEE,
    lastValidStateId,
    updatedBy,
    transaction,
  );
}

async function refundBucketToClient(
  deps: BucketMovementDeps,
  journalTransaction: JournalTransaction,
  fromBookPurposeId: number,
  bookPostingPurposeId: number,
  fromStateId: number,
  updatedBy: number | null | undefined,
  transaction: Transaction,
): Promise<void> {
  const fromBook = await findBookByJournalAndPurpose(journalTransaction.id, fromBookPurposeId, transaction, fromStateId, bookPostingPurposeId);

  const clientBookUnlocked = await openBook(
    deps.bookRepository,
    {
      code: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
      bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
      transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
      asset: assetDescriptorOfBook(fromBook),
      createdBy: updatedBy ?? null,
    },
    transaction,
  );

  const locked = await deps.bookRepository.lockBooksInOrder([fromBook.id, clientBookUnlocked.id], transaction);
  const lockedFromBook = locked.get(fromBook.id)!;
  const clientBook = locked.get(clientBookUnlocked.id)!;

  // legIndexOffset 900 dành riêng cho nhánh hoàn tiền (-> legIndex 901/902)
  // — không bao giờ đụng token của các bước advance bình thường (1/2).
  await postDoubleEntry(
    deps.bookPostingRepository,
    {
      journalTransactionId: journalTransaction.id,
      fromBook: lockedFromBook,
      toBook: clientBook,
      amount: lockedFromBook.amount,
      assetTypeId: lockedFromBook.assetTypeId,
      bookPostingPurposeId,
      historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
      createdBy: updatedBy,
      businessPostDateTime: new Date(),
      idempotencyToken: resolveBaseIdempotencyToken(journalTransaction),
      transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
      tokenStateId: fromStateId,
      legIndexOffset: 900,
    },
    transaction,
  );
}
