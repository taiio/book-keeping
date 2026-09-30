import type { ValueOf } from '../types/common';

export const TRANSACTION_TYPE = {
  DEPOSIT: 1,
  WITHDRAW: 2,
  STAKE: 3,
  UNSTAKE: 4,
  RESTAKE: 5,
} as const;

export type TransactionTypeId = ValueOf<typeof TRANSACTION_TYPE>;
export type TransactionTypeCode = keyof typeof TRANSACTION_TYPE;
