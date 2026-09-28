import type { Transaction as SequelizeTransaction } from 'sequelize';

import type { Book, JournalTransaction } from '../models';
import type { JournalTransactionStateValue } from './transaction';

// ----------------------------------------------------------------------
// Unit of work
// ----------------------------------------------------------------------

/**
 * UnitOfWork bọc toàn bộ 1 "business command" trong đúng 1 DB transaction, để mọi
 * repository ghi dữ liệu + history cùng commit hoặc cùng rollback.
 */
export interface IUnitOfWork {
  execute<T>(work: (tx: SequelizeTransaction) => Promise<T>, isolationLevel?: SequelizeTransaction.ISOLATION_LEVELS): Promise<T>;
}

// ----------------------------------------------------------------------
// Book / BookPosting / BookHistory
// ----------------------------------------------------------------------

/** Định danh + thuộc tính để get-or-create 1 Book (unique theo idx_unique_book). */
export interface BookLegParams {
  name?: string;
  clientId: number;
  accountId: number;
  assetId: number;
  assetTypeId: number;
  assetTicker: string;
  walletTypeId: number;
  bookPurposeId: number;
  transactionStateId: number | null;
  address?: string;
  createdBy?: number;
}

export interface GetOrCreateBookResult {
  book: Book;
  created: boolean;
}

export interface UpdateBookParams {
  /** Book ĐÃ được khoá (FOR UPDATE) trong cùng transaction. */
  book: Book;
  amountDelta: string;
  sequenceNo: number;
  bookPostingId?: number | null;
  updatedBy?: number | null;
}

export interface CreateBookPostingParams {
  bookId: number;
  journalTransactionId: number;
  /** Số ÂM = trừ khỏi book, số DƯƠNG = cộng vào book. */
  amount: string;
  assetTypeId: number | null;
  bookPostingPurposeId: number;
  businessPostDateTime: Date;
  /** Khoá idempotency — gọi lại cùng token là no-op, không tạo thêm posting/history. */
  idempotencyToken: string;
  createdBy?: number;
}

export interface RecordBookHistoryParams {
  /** HISTORY_EVENT_TYPE.CREATED (book mới, chưa có posting) hoặc POSTING_APPLIED. */
  historyTransactionTypeId: number;
  bookId: number;
  bookPostingId?: number | null;
  /** Số dư của book SAU sự kiện này (snapshot, không phải delta). */
  amount: string;
  lastSequenceNo: number;
  createdBy?: number | null;
}

// ----------------------------------------------------------------------
// JournalTransaction / JournalTransactionHistory
// ----------------------------------------------------------------------

export interface GetOrCreateJournalTransactionParams {
  /** Không truyền -> luôn tạo mới (không được gộp theo token null). */
  idempotencyToken?: string | null;
  uuidToken: string;
  transactionTypeId: number;
  transactionStateId?: number | null;
  transactionHash?: string | null;
  /** Payload gốc (JSON) — BlockchainEventHandler dùng để correlate và dựng lại legs khi settle/release. */
  sourceContent?: string | null;
  fromAccountId?: number | null;
  toAccountId?: number | null;
  businessPostDateTime?: Date;
  createdBy?: number;
}

export interface GetOrCreateJournalTransactionResult {
  journalTransaction: JournalTransaction;
  created: boolean;
}

export interface UpdateJournalTransactionParams {
  journalTransactionId: number;
  transactionHash?: string;
  targetTransactionStateId?: number;
  /** Có truyền -> FSM chặt: target phải đúng là bước kế tiếp trong chuỗi này. */
  expectedStateSequence?: readonly number[];
  /** Không truyền -> giữ nguyên state hiện tại của journal (ACTIVE). */
  journalTransactionState?: JournalTransactionStateValue;
  updatedBy?: number;
}

/**
 * - APPLIED: state vừa được cập nhật, đã ghi history.
 * - REPLAYED_NOOP: duplicate/late event hoặc journal đã kết thúc — không có gì thay đổi.
 * - REJECTED_INVALID_TRANSITION: target bỏ bước / sai thứ tự — journal đã bị CANCELLED trong chính lần gọi này.
 */
export type JournalTransitionOutcome = 'APPLIED' | 'REPLAYED_NOOP' | 'REJECTED_INVALID_TRANSITION';

export interface UpdateJournalTransactionResult {
  journalTransaction: JournalTransaction;
  outcome: JournalTransitionOutcome;
  /** State chi tiết của journal TRƯỚC lệnh này — chính là bucket nguồn mà hiệu ứng kế toán phải trừ ra. */
  previousTransactionStateId: number | null;
}

export interface RecordJournalTransactionHistoryParams {
  /** Journal ở trạng thái SAU sự kiện — history lưu snapshot của chính journal này. */
  journalTransaction: JournalTransaction;
  historyTransactionTypeId: number;
  createdBy?: number | null;
}
