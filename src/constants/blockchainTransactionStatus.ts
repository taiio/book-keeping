import { TRANSACTION_STATE } from './transactionState';

/**
 * Trạng thái của 1 blockchain event. CONFIRMING/CONFIRMED dùng lại đúng code của
 * TRANSACTION_STATE; FAILED chỉ tồn tại ở phía blockchain (phía ledger được biểu
 * diễn bằng JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED).
 */
export const BLOCKCHAIN_TRANSACTION_STATUS = {
  CONFIRMING: TRANSACTION_STATE.CONFIRMING.code,
  CONFIRMED: TRANSACTION_STATE.CONFIRMED.code,
  FAILED: 'FAILED',
} as const;
