import { TRANSACTION_STATE } from './transactionState';

/**
 * Status of a blockchain transaction.
 *
 * CONFIRMING and CONFIRMED reuse the corresponding transaction state codes.
 * FAILED represents a blockchain execution failure.
 */
export const BLOCKCHAIN_TRANSACTION_STATUS = {
  CONFIRMING: TRANSACTION_STATE.CONFIRMING.code,
  CONFIRMED: TRANSACTION_STATE.CONFIRMED.code,
  FAILED: TRANSACTION_STATE.FAILED.code,
} as const;

export type BlockchainTransactionStatus = (typeof BLOCKCHAIN_TRANSACTION_STATUS)[keyof typeof BLOCKCHAIN_TRANSACTION_STATUS];
