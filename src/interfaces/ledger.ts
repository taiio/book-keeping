import type { Book } from '../models';
import type { BookLegParams, UpdateJournalTransactionParams } from './persistence';
import type { AccountItem, FeeItem } from './transaction';

export type LegItem = AccountItem | FeeItem;

export interface AccountingLegs {
  /** Tài sản RỜI custody: Available -> Reserved -> Authorized -> Sent -> Confirming, rồi ra external ở CONFIRMED. */
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

/** LedgerOperationParams + bucket nguồn/đích (state id) của bước ADVANCE / RELEASE / SETTLE. */
export interface BucketMoveParams extends LedgerOperationParams {
  /** State của journal TRƯỚC khi chuyển — bucket nguồn (mỗi state có bucket riêng, kể cả AUTHORIZING = Reserved). */
  fromStateId: number;
  /** State đích của ADVANCE. Không dùng cho RELEASE (luôn về Available) và SETTLE (luôn ra External). */
  toStateId?: number;
}

export type ReserveResult = { ok: true } | { ok: false; shortfalls: string[] };

/** Bút toán đúp của DEPOSIT — book custody (Available) nhận tiền đã biết trước, Confirming/External suy ra từ book đó. */
export interface DepositMovementParams {
  journalTransactionId: number;
  uuidToken: string;
  matchedCustodyBook: Book;
  quantity: string;
  createdBy?: number;
}

/** Các bước của bút toán DEPOSIT: CONFIRMING (external -> confirming), CONFIRMED (confirming -> available), FAILED (confirming -> external). */
export type DepositPhase = 'CONFIRMING' | 'CONFIRMED' | 'FAILED';

export interface ApplyMovementParams {
  fromBook: Book;
  toBook: Book;
  quantity: string;
  purposeId: number;
  journalTransactionId: number;
  movementKey: string;
  createdBy?: number;
}

/**
 * Hiệu ứng kế toán chạy khi journal chuyển state thành công (outcome = APPLIED). "Từ bucket" luôn là
 * state TRƯỚC khi chuyển (repository trả về `previousTransactionStateId`), nên không caller nào phải tự nhớ.
 *   - ADVANCE: bucket(state trước) -> bucket(state mới) cho từng debit + fee (Available->Reserved->Authorized->Sent->Confirming).
 *   - SETTLE : CONFIRMED — Confirming -> External (amount); Confirming -> Fee Confirming -> Fee Revenue (fee).
 *   - RELEASE: FAILED/REJECTED — bucket(state trước) -> Available.
 */
export type LedgerEffect = 'ADVANCE' | 'SETTLE' | 'RELEASE';

/** Giai đoạn của movement — là hậu tố của khoá idempotency (xem helpers/idempotency.ts). */
export type LedgerPhase = `ADV:${string}` | 'RVT' | 'SET';

export interface TransitionParams extends UpdateJournalTransactionParams {
  /** Legs của transaction gốc; cần khi có `onApplied`. null = không dựng lại được (sourceContent thiếu/hỏng). */
  legs?: AccountingLegs | null;
  /**
   * Hiệu ứng kế toán CHỈ chạy khi outcome = APPLIED. REPLAYED_NOOP (event trùng) và
   * REJECTED_INVALID_TRANSITION KHÔNG có hiệu ứng nào — xem ghi chú ở LedgerPipeline.transition().
   */
  onApplied?: LedgerEffect;
}
