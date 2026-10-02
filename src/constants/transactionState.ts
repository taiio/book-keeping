import type { ValueOf } from '../types/common';

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

export type TransactionStateDefinition = ValueOf<typeof TRANSACTION_STATE>;

export type TransactionStateId = NonNullable<TransactionStateDefinition['id']>;

export type TransactionStateCode = NonNullable<TransactionStateDefinition['code']>;

export const TRANSACTION_STATE_SEQUENCE = [
  TRANSACTION_STATE.AUTHORIZING.id,
  TRANSACTION_STATE.AUTHORIZED.id,
  TRANSACTION_STATE.SENT.id,
  TRANSACTION_STATE.CONFIRMING.id,
  TRANSACTION_STATE.CONFIRMED.id,
] as const;

export const TRANSACTION_STATE_RANK: Readonly<Record<number, number>> = Object.fromEntries(
  TRANSACTION_STATE_SEQUENCE.map((stateId, index) => [stateId, index]),
);
