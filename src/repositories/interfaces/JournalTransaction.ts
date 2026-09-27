export interface GetOrCreateJournalTransactionParams {
  idempotencyToken: string;
  uuidToken: string;
  transactionTypeId: number;
  fromAccountId?: number | null;
  toAccountId?: number | null;
  transactionHash?: string | null;
  createdBy?: number | null;
  /** journal_transaction_state ghi vào JournalTransaction + JournalTransactionHistory lúc tạo (vd ACTIVE). */
  journalTransactionState: string | null;
  /**
   * State chi tiết BAN ĐẦU của vòng đời nghiệp vụ (vd TRANSACTION_STATE.AUTHORIZING.id
   * cho withdraw/stake, TRANSACTION_STATE.CONFIRMING.id cho deposit). Nullable vì không
   * phải flow nào cũng cần granularity này.
   */
  transactionStateId?: number | null;
  historyTransactionTypeId: number | null;
  businessPostDateTime: Date;
}

export interface GetOrCreateJournalTransactionResult {
  journalTransaction: import('../../models').JournalTransaction;
  created: boolean;
}

export type UpdateJournalTransactionOutcome = 'APPLIED' | 'REPLAYED_NOOP' | 'REJECTED_INVALID_TRANSITION';

export interface UpdateJournalTransactionResult {
  journalTransaction: import('../../models').JournalTransaction;
  outcome: UpdateJournalTransactionOutcome;
}

export interface UpdateJournalTransactionParams {
  journalTransactionId: number;
  /** journal_transaction_state ghi vào JournalTransactionHistory (vd ACTIVE/COMPLETED) khi advance HỢP LỆ. */
  journalTransactionState: string;
  historyTransactionTypeId: number;
  transactionHash?: string | null;
  updatedBy?: number | null;
  /** State chi tiết ĐÍCH của lần advance này (vd TRANSACTION_STATE.SENT.id). */
  targetTransactionStateId?: number | null;
  /**
   * Toàn bộ chuỗi state HỢP LỆ cho flow/kind cụ thể đang gọi — vd withdraw
   * "external": [AUTHORIZING, AUTHORIZED, SENT, CONFIRMING, CONFIRMED].id;
   * withdraw "internal": [AUTHORIZING, AUTHORIZED, CONFIRMED].id (bỏ qua
   * SENT/CONFIRMING vì không có tx blockchain thật).
   *
   * Khi có truyền (cùng với targetTransactionStateId): hàm định vị
   * currentIndex = sequence.indexOf(journal.transactionStateId hiện tại) và
   * targetIndex = sequence.indexOf(targetTransactionStateId), rồi:
   *   - targetIndex !== -1 && targetIndex <= currentIndex -> REPLAYED_NOOP
   *     (đã áp dụng rồi hoặc đi lùi -> coi là duplicate/late event, bỏ qua).
   *   - targetIndex === currentIndex + 1 -> APPLIED (đúng bước kế tiếp).
   *   - Mọi trường hợp khác (bỏ bước, target không thuộc chuỗi...) ->
   *     REJECTED_INVALID_TRANSITION: journal bị chuyển thẳng sang
   *     CANCELLED_OR_EXPIRED NGAY LẬP TỨC, bất kể completeJournal/cancelJournal
   *     truyền là gì.
   *
   * Không truyền -> chỉ áp dụng guard rank đơn giản qua TRANSACTION_STATE_RANK
   * (target <= hiện tại thì no-op) như trước, KHÔNG có kiểm tra "đúng bước kế
   * tiếp" — dùng cho các flow không cần FSM chặt (Deposit, Stake).
   */
  expectedStateSequence?: number[];
  /** Đánh dấu journal_transaction_state = COMPLETED khi đạt state cuối cùng (chỉ có hiệu lực nếu kết quả là APPLIED). */
  completeJournal?: boolean;
  /** Đánh dấu journal_transaction_state = CANCELLED_OR_EXPIRED (chỉ có hiệu lực nếu kết quả là APPLIED). */
  cancelJournal?: boolean;
}
