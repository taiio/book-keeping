export const JOURNAL_TRANSACTION_STATE = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  CANCELLED_OR_EXPIRED: 'CANCELLED_OR_EXPIRED',
} as const;

/**
 * Các state coi là "kết thúc" (terminal). Một khi journal đã vào 1 trong 2
 * state này thì mọi lệnh update tiếp theo (kể cả state trùng, hay 1 event
 * bị gửi lại / đến trễ) đều là replay và phải là no-op — không được ghi
 * thêm history, không được đổi state ngược lại.
 */
export const TERMINAL_JOURNAL_TRANSACTION_STATES: ReadonlySet<string> = new Set([
  JOURNAL_TRANSACTION_STATE.COMPLETED,
  JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED,
]);
