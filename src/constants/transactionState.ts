export const TRANSACTION_STATE = {
  /**
   * Supports the EXTERNAL blockchain book, which has no detailed transaction state.
   */
  NOT_APPLICABLE: {
    id: null,
    code: null,
    name: 'Not Applicable',
    description: 'No transaction state applies to this record.',
  },

  // Happy-path states
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
    description: 'The transaction is waiting for blockchain confirmations.',
  },

  CONFIRMED: {
    id: 5,
    code: 'CONFIRMED',
    name: 'Confirmed',
    description: 'The transaction has received sufficient blockchain confirmations.',
  },

  // Terminal / exception states
  REJECTED: {
    id: 90,
    code: 'REJECTED',
    name: 'Rejected',
    description: 'The transaction was rejected before blockchain submission.',
  },

  FAILED: {
    id: 91,
    code: 'FAILED',
    name: 'Failed',
    description: 'The transaction failed after processing started.',
  },
} as const;

type NonNull<T> = Exclude<T, null>;

export type TransactionStateId = NonNull<(typeof TRANSACTION_STATE)[keyof typeof TRANSACTION_STATE]['id']>;

export type TransactionStateCode = NonNull<(typeof TRANSACTION_STATE)[keyof typeof TRANSACTION_STATE]['code']>;

/**
 * Happy-path lifecycle.
 *
 * States must be entered in this exact order.
 * Exception states such as REJECTED and FAILED are not part of this sequence.
 */
export const TRANSACTION_STATE_SEQUENCE = [
  TRANSACTION_STATE.AUTHORIZING.id,
  TRANSACTION_STATE.AUTHORIZED.id,
  TRANSACTION_STATE.SENT.id,
  TRANSACTION_STATE.CONFIRMING.id,
  TRANSACTION_STATE.CONFIRMED.id,
] as const;

/**
 * Rank of each happy-path state.
 *
 * Used to compare lifecycle order and enforce that a journal
 * transaction cannot skip a happy-path state.
 */
export const TRANSACTION_STATE_RANK: Readonly<Record<number, number>> = Object.fromEntries(
  TRANSACTION_STATE_SEQUENCE.map((stateId, index) => [stateId, index]),
);

/**
 * Lookup transaction state code by state ID.
 *
 * NOT_APPLICABLE is excluded because its ID and code are null.
 */
export const TRANSACTION_STATE_CODE_BY_ID: Readonly<Record<number, string>> = Object.fromEntries(
  Object.values(TRANSACTION_STATE)
    .filter((state) => state.id !== null)
    .map((state) => [state.id, state.code]),
) as Record<number, string>;

/**
 * States that can transition to FAILED due to blockchain processing.
 */
export const TRANSACTION_STATE_IDS_FAILABLE_BY_BLOCKCHAIN: readonly number[] = [TRANSACTION_STATE.SENT.id, TRANSACTION_STATE.CONFIRMING.id];

/**
 * Allowed state transitions.
 *
 * REJECTED represents an explicit business/user/system rejection
 * before blockchain submission.
 *
 * FAILED represents a blockchain/processing failure after
 * blockchain processing has started.
 */
export const TRANSACTION_STATE_TRANSITIONS = {
  AUTHORIZING: [TRANSACTION_STATE.AUTHORIZED.code, TRANSACTION_STATE.REJECTED.code],

  AUTHORIZED: [TRANSACTION_STATE.SENT.code, TRANSACTION_STATE.REJECTED.code],

  SENT: [TRANSACTION_STATE.CONFIRMING.code, TRANSACTION_STATE.FAILED.code],

  CONFIRMING: [TRANSACTION_STATE.CONFIRMED.code, TRANSACTION_STATE.FAILED.code],

  CONFIRMED: [],
  REJECTED: [],
  FAILED: [],
} as const;
