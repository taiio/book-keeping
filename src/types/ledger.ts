import type { BookPostingPurposeId } from '../constants';
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
  /** Amounts reported by the sender of the event. Not needed to close (REJECTED / FAILED) a transaction. */
  legs: LedgerLeg[];
  /** Real network fee, reported by the blockchain when a transaction FAILED after being mined. */
  consumedFee?: string;
}

/**
 * What happened to a request:
 *  - APPLIED   : postings and history were written.
 *  - DUPLICATE : the target state was already applied (message replay). Nothing was written.
 *  - STALE     : the journal transaction is already past the target state. Nothing was written.
 */
export type TransitionOutcome = 'APPLIED' | 'DUPLICATE' | 'STALE';

export interface TransitionResult {
  journalTransactionId: number;
  outcome: TransitionOutcome;
}

/** A double-entry movement: value leaves the `from` book and lands in the `to` book. */
export interface LedgerMovement {
  from: BookRef;
  to: BookRef;
}

/** A planned movement together with the resolved books it moves value between. */
export interface ResolvedPosting {
  planned: PlannedPosting;
  from: Book;
  to: Book;
}
