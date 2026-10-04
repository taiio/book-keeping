import type { BookPostingPurposeId, TRANSITION_DECISION, TransitionOutcome } from '../constants';
import type { Book, JournalTransaction } from '../models';
import type { PlannedPosting } from './planning';
import type { LegItem } from './account';
import type { BookRef } from './book';

export interface LedgerLeg {
  item: LegItem;
  amount: string;
  purpose: BookPostingPurposeId;
}

export interface TransitionRequest {
  journalTransaction: JournalTransaction;
  targetStateId: number;
  legs: LedgerLeg[];
  consumedFee?: string;
}

export interface TransitionResult {
  journalTransactionId: string;
  outcome: TransitionOutcome;
}

export interface LedgerMovement {
  from: BookRef;
  to: BookRef;
}

export interface ResolvedPosting {
  planned: PlannedPosting;
  from: Book;
  to: Book;
}

export type TransitionDecision =
  | { kind: typeof TRANSITION_DECISION.APPLY }
  | { kind: typeof TRANSITION_DECISION.CATCH_UP; via: readonly number[] }
  | { kind: typeof TRANSITION_DECISION.DUPLICATE }
  | { kind: typeof TRANSITION_DECISION.STALE }
  | { kind: typeof TRANSITION_DECISION.EARLY };

export interface EvaluateParams {
  transactionTypeId: number;
  currentStateId: number | null;
  targetStateId: number;
  journalTransactionId: string;
  journalTransactionState: number;
}

export interface TransitionStep {
  journalTransaction: JournalTransaction;
  targetStateId: number;
  synthetic: boolean;
  planned: PlannedPosting[];
}
