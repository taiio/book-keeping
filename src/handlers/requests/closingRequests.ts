import type { JournalTransaction } from '../../models';
import type { TransitionRequest } from '../../types';

export function buildClosingRequests(journalTransactions: JournalTransaction[], targetStateId: number, consumedFee?: string): TransitionRequest[] {
  return journalTransactions.map((journalTransaction) => ({ journalTransaction, targetStateId, legs: [], consumedFee }));
}
