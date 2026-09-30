import type { BookPostingPurposeId } from '../constants';
import type { Book, JournalTransaction } from '../models';
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
}

export interface TransitionResult {
  journalTransactionId: number;
  applied: boolean;
}

/** A double-entry movement: value leaves the `from` book and lands in the `to` book. */
export interface LedgerMovement {
  from: BookRef;
  to: BookRef;
}

/** A leg together with the resolved books it moves value between. */
export interface LegBooks {
  leg: LedgerLeg;
  from: Book;
  to: Book;
}
