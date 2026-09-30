import { TRANSACTION_STATE } from './transactionState';
import type { ValueOf } from '../types/common';

export const BLOCKCHAIN_TRANSACTION_STATE_ID = {
  CONFIRMING: TRANSACTION_STATE.CONFIRMING.id,
  CONFIRMED: TRANSACTION_STATE.CONFIRMED.id,
  FAILED: TRANSACTION_STATE.FAILED.id,
} as const;

export type BlockchainTransactionStateId = ValueOf<typeof BLOCKCHAIN_TRANSACTION_STATE_ID>;
