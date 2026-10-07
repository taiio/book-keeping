import type { ValueOf } from '../types/common';

export const JOURNAL_TRANSACTION_STATE = {
  ACTIVE: 1,
  COMPLETED: 2,
  FAILED: 3,
  REJECTED: 4,
} as const;

export type JournalTransactionStateId = ValueOf<typeof JOURNAL_TRANSACTION_STATE>;

export const JOURNAL_TRANSACTION_STATE_IDS: readonly JournalTransactionStateId[] = Object.values(JOURNAL_TRANSACTION_STATE);
