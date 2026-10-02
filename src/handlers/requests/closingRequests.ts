import type { JournalTransaction } from '../../models';
import type { TransitionRequest } from '../../types';

/**
 * REJECTED / FAILED need no amounts: the ledger reverses what each journal transaction holds.
 * `consumedFee` is the real fee of a mined transaction that failed.
 */
export function buildClosingRequests(journalTransactions: JournalTransaction[], targetStateId: number, consumedFee?: string): TransitionRequest[] {
  return journalTransactions.map((journalTransaction) => ({ journalTransaction, targetStateId, legs: [], consumedFee }));
}
