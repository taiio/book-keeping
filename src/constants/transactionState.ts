export const TRANSACTION_STATE = {
  // Please don't remove: this record supports the EXTERNAL blockchain book, which has no detailed state.
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

/**
 * Bucket của từng state: mỗi state của system transaction có 1 book CUSTODY riêng, và VÀO state nào thì post
 * bucket(state trước) -> bucket(state đó) — kể cả AUTHORIZING (sau khi kiểm tra amount + fee đủ).
 *   CONFIRMED  = Available    AUTHORIZING = Reserved     AUTHORIZED = Authorized
 *   SENT       = Sent         CONFIRMING  = Confirming
 * DEPOSIT dùng lại bucket Confirming (không có book Pending riêng).
 */

/**
 * Chuỗi state hợp lệ của 1 transaction, theo đúng thứ tự vòng đời — KHÔNG được bỏ bước.
 * Dùng cho FSM chặt ở JournalTransactionRepository (`expectedStateSequence`) và
 * là nguồn duy nhất để suy ra `TRANSACTION_STATE_RANK`.
 */
export const TRANSACTION_STATE_SEQUENCE: readonly number[] = [
  TRANSACTION_STATE.AUTHORIZING.id,
  TRANSACTION_STATE.AUTHORIZED.id,
  TRANSACTION_STATE.SENT.id,
  TRANSACTION_STATE.CONFIRMING.id,
  TRANSACTION_STATE.CONFIRMED.id,
];

/**
 * Rank của từng state (vị trí trong `TRANSACTION_STATE_SEQUENCE`), dùng để so sánh
 * "state nào đứng trước/sau state nào" (guard monotonic khi advance một journal).
 *
 * Rank được suy ra từ THỨ TỰ khai báo của chuỗi state chứ không lấy thẳng `id`:
 * id là khoá định danh ổn định cho FK/DB, còn thứ tự vòng đời là một khái niệm
 * nghiệp vụ riêng — chèn thêm state mới với id không tuần tự vẫn không làm sai guard.
 */
export const TRANSACTION_STATE_RANK: Readonly<Record<number, number>> = Object.fromEntries(
  TRANSACTION_STATE_SEQUENCE.map((stateId, index) => [stateId, index]),
);

/** Tra ngược code của state theo id (bỏ qua NOT_APPLICABLE vì id/code = null). */
export const TRANSACTION_STATE_CODE_BY_ID: Readonly<Record<number, string>> = Object.fromEntries(
  Object.values(TRANSACTION_STATE)
    .filter((state) => state.id !== null)
    .map((state) => [state.id, state.code]),
) as Record<number, string>;

/**
 * State mà 1 system transaction còn có thể bị FAILED từ blockchain
 * (biên "SENT/CONFIRMING -> FAILED" của design doc).
 */
export const TRANSACTION_STATE_IDS_FAILABLE_BY_BLOCKCHAIN: readonly number[] = [TRANSACTION_STATE.SENT.id, TRANSACTION_STATE.CONFIRMING.id];
