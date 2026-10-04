import type { BookPostingPurposeId } from '../constants';
import type { LegItem } from './account';
import type { BookRef } from './book';
import type { LedgerLeg } from './ledger';

export interface Holding {
  ref: BookRef;
  item: LegItem;
  purpose: BookPostingPurposeId;
  amount: bigint;
}

export interface PlannedPosting {
  item: LegItem;
  from: BookRef;
  to: BookRef;
  amount: string;
  purpose: BookPostingPurposeId;
}

export interface PlanInput {
  journalTransactionId: string;
  transactionTypeId: number;
  currentStateId: number | null;
  targetStateId: number;
  legs: LedgerLeg[];
  holdings: Holding[];
  consumedFee?: string;
}
