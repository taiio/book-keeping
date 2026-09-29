import type { Book } from '../models';
import type { BookLegParams, UpdateJournalTransactionParams } from './persistence';
import type { AccountItem, FeeItem } from './transaction';

export type LegItem = AccountItem | FeeItem;

export interface AccountingLegs {
  debitItems: AccountItem[];
  creditItems: AccountItem[];
  fee: FeeItem;
}

export interface LegMovement {
  key: string;
  item: LegItem;
  purposeId: number;
}

export interface MovementSpec extends LegMovement {
  fromLeg: BookLegParams;
  toLeg: BookLegParams;
}

export interface ResolvedBooks {
  fromBook: Book;
  toBook: Book;
}

export interface LedgerOperationParams {
  journalTransactionId: number;
  uuidToken: string;
  idempotencyToken: string;
  transactionTypeId: number;
  legs: AccountingLegs;
  createdBy?: number;
}

export interface BucketMoveParams extends LedgerOperationParams {
  fromStateId: number;
  toStateId?: number;
}

export type ReserveResult = { ok: true } | { ok: false; shortfalls: string[] };

export interface DepositMovementParams {
  journalTransactionId: number;
  uuidToken: string;
  idempotencyToken: string;
  transactionTypeId: number;
  matchedCustodyBook: Book;
  quantity: string;
  createdBy?: number;
}

export type DepositPhase = 'CONFIRMING' | 'CONFIRMED' | 'FAILED';

export interface ApplyMovementParams {
  fromBook: Book;
  toBook: Book;
  quantity: string;
  purposeId: number;
  journalTransactionId: number;
  debitIdempotencyToken: string;
  creditIdempotencyToken: string;
  createdBy?: number;
}

export type LedgerEffect = 'ADVANCE' | 'SETTLE' | 'RELEASE';

export interface TransitionParams extends UpdateJournalTransactionParams {
  legs?: AccountingLegs | null;
  onApplied?: LedgerEffect;
}
