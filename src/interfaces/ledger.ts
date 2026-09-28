import type { Book } from '../models';
import type { BookLegParams, UpdateJournalTransactionParams } from './persistence';
import type { AccountItem, FeeItem } from './transaction';

export type LegItem = AccountItem | FeeItem;

export interface AccountingLegs {
  /** Tài sản RỜI custody: reserve ở AUTHORIZING, release ra external ở CONFIRMED. */
  debitItems: AccountItem[];
  /** Tài sản VÀO custody: settle từ external về custody ở CONFIRMED (chỉ UNSTAKE dùng). */
  creditItems: AccountItem[];
  fee: FeeItem;
}

export interface LegMovement {
  key: string;
  item: LegItem;
  purposeId: number;
}

export interface MovementSpec extends LegMovement {
  fromLeg: BookLegParams;
  toLeg: BookLegParams;
}

export interface ResolvedBooks {
  fromBook: Book;
  toBook: Book;
}

export interface LedgerOperationParams {
  journalTransactionId: number;
  uuidToken: string;
  legs: AccountingLegs;
  createdBy?: number;
}

export type ReserveResult = { ok: true } | { ok: false; shortfalls: string[] };

export interface SettleDepositParams {
  journalTransactionId: number;
  uuidToken: string;
  matchedCustodyBook: Book;
  quantity: string;
  createdBy?: number;
}

export interface ApplyMovementParams {
  fromBook: Book;
  toBook: Book;
  quantity: string;
  purposeId: number;
  journalTransactionId: number;
  movementKey: string;
  createdBy?: number;
}

/** Hiệu ứng kế toán chạy khi journal chuyển state thành công (outcome = APPLIED). */
export type LedgerEffect = 'SETTLE' | 'RELEASE';

/** Giai đoạn của movement — là hậu tố của khoá idempotency (xem helpers/idempotency.ts). */
export type LedgerPhase = 'RSV' | 'RVT' | 'SET';

export interface TransitionParams extends UpdateJournalTransactionParams {
  /** Legs của transaction gốc; cần khi có `onApplied`. null = không dựng lại được (sourceContent thiếu/hỏng). */
  legs?: AccountingLegs | null;
  /**
   * Hiệu ứng kế toán CHỈ chạy khi outcome = APPLIED. REPLAYED_NOOP (event trùng) và
   * REJECTED_INVALID_TRANSITION KHÔNG có hiệu ứng nào — xem ghi chú ở LedgerPipeline.transition().
   */
  onApplied?: LedgerEffect;
}
