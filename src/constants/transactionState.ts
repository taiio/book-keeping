export const TRANSACTION_STATE = {
  // please dont remove, we need to this record. this record support the book purpose is external blockchian.
    NOT_APPLICABLE: {
    id: null,
    code: null,
    name: 'Not Applicable',
    description: 'No transaction state applies to this record.',
  },

  AUTHORIZING: {
    id: 1,
    code: 'AUTHORIZING',
    name: 'Authorizing',
    description: 'The transaction is being reviewed and authorized.',
  },

  AUTHORIZED: {
    id: 2,
    code: 'AUTHORIZED',
    name: 'Authorized',
    description: 'The transaction has been authorized and is ready for processing.',
  },

  SENT: {
    id: 3,
    code: 'SENT',
    name: 'Sent',
    description: 'The transaction has been submitted to the blockchain network.',
  },

  CONFIRMING: {
    id: 4,
    code: 'CONFIRMING',
    name: 'Confirming',
    description: 'The transaction has been submitted and is waiting for blockchain confirmations.',
  },

  CONFIRMED: {
    id: 5,
    code: 'CONFIRMED',
    name: 'Confirmed',
    description: 'The transaction has received sufficient blockchain confirmations and is considered final.',
  },
} as const;

export type TransactionStateKey = keyof typeof TRANSACTION_STATE;

/**
 * Rank tường minh cho từng transaction state, dùng để so sánh "state nào
 * đứng trước/sau state nào" (guard monotonic khi advance một journal).
 *
 * Cố tình khai báo tường minh thay vì dùng thẳng `TRANSACTION_STATE.X.id`
 * làm rank: id là khoá định danh ổn định cho FK/DB, còn thứ tự vòng đời là
 * một khái niệm nghiệp vụ riêng — nếu sau này có ai chèn thêm 1 state mới
 * với id không nằm đúng vị trí tuần tự (vd thêm "REJECTED" với id = 6 nhưng
 * đứng trước SENT về mặt nghiệp vụ), guard vẫn đúng vì rank được khai báo
 * độc lập với id.
 */
export const TRANSACTION_STATE_RANK: Record<number, number> = {
  [TRANSACTION_STATE.AUTHORIZING.id]: 0,
  [TRANSACTION_STATE.AUTHORIZED.id]: 1,
  [TRANSACTION_STATE.SENT.id]: 2,
  [TRANSACTION_STATE.CONFIRMING.id]: 3,
  [TRANSACTION_STATE.CONFIRMED.id]: 4,
};
