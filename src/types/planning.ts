import type { BookPostingPurposeId } from '../constants';
import type { LegItem } from './account';
import type { BookRef } from './book';
import type { LedgerLeg } from './ledger';

/** Value a journal transaction currently holds in one book (sum of its postings on that book, per purpose). */
export interface Holding {
  ref: BookRef;
  item: LegItem;
  purpose: BookPostingPurposeId;
  amount: bigint;
}

/** One double-entry pair decided by the planner: `amount` leaves `from` and lands in `to`. */
export interface PlannedPosting {
  item: LegItem;
  from: BookRef;
  to: BookRef;
  amount: string;
  purpose: BookPostingPurposeId;
}

export interface PlanInput {
  journalTransactionId: number;
  transactionTypeId: number;
  currentStateId: number | null;
  targetStateId: number;
  legs: LedgerLeg[];
  holdings: Holding[];
  /** Real fee to charge when closing a transaction as FAILED after it was mined. */
  consumedFee?: string;
}
