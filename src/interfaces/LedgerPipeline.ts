import type { Transaction } from 'sequelize';

import type { BookPostingPurposeId } from '../constants';
import type { LegItem } from './';
import { JournalTransaction } from '../models';

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

export interface LedgerTransitionContext {
  transaction: Transaction;
}
