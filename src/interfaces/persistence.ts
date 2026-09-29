import type { Transaction as SequelizeTransaction } from 'sequelize';

import type { Book, JournalTransaction } from '../models';
import type { JournalTransactionStateValue } from './transaction';

export interface IUnitOfWork {
  execute<T>(work: (tx: SequelizeTransaction) => Promise<T>, isolationLevel?: SequelizeTransaction.ISOLATION_LEVELS): Promise<T>;
}

export interface BookLegParams {
  name?: string;
  clientId: number;
  accountId: number;
  assetId: number;
  assetTypeId: number;
  assetTicker: string;
  walletTypeId: number;
  bookPurposeId: number;
  transactionStateId: number | null;
  address?: string;
  createdBy?: number;
}

export interface GetOrCreateBookResult {
  book: Book;
  created: boolean;
}

export interface UpdateBookParams {
  book: Book;
  amountDelta: string;
  sequenceNo: number;
  bookPostingId?: number | null;
  updatedBy?: number | null;
}

export interface CreateBookPostingParams {
  bookId: number;
  journalTransactionId: number;

  amount: string;
  assetTypeId: number | null;
  bookPostingPurposeId: number;
  businessPostDateTime: Date;

  idempotencyToken: string;
  createdBy?: number;
}

export interface RecordBookHistoryParams {
  historyTransactionTypeId: number;
  bookId: number;
  bookPostingId?: number | null;

  amount: string;
  lastSequenceNo: number;
  createdBy?: number | null;
}

export interface GetOrCreateJournalTransactionParams {
  idempotencyToken?: string | null;
  uuidToken: string;
  transactionTypeId: number;

  transactionStateId?: number | null;
  transactionHash?: string | null;
  sourceContent?: string | null;
  fromAccountId?: number | null;
  toAccountId?: number | null;
  businessPostDateTime?: Date;
  createdBy?: number;
}

export interface GetOrCreateJournalTransactionResult {
  journalTransaction: JournalTransaction;
  created: boolean;
}

export interface UpdateJournalTransactionParams {
  journalTransactionId: number;

  transactionHash?: string;
  targetTransactionStateId?: number;

  expectedStateSequence?: readonly number[];
  journalTransactionState?: JournalTransactionStateValue;
  updatedBy?: number;
}

export type JournalTransitionOutcome = 'APPLIED' | 'REPLAYED_NOOP' | 'REJECTED_INVALID_TRANSITION';

export interface UpdateJournalTransactionResult {
  journalTransaction: JournalTransaction;
  outcome: JournalTransitionOutcome;
  previousTransactionStateId: number | null;

  transactionStateId: number | null;
}

export interface RecordJournalTransactionHistoryParams {
  journalTransaction: JournalTransaction;
  historyTransactionTypeId: number;

  transactionStateId?: number | null;
  createdBy?: number | null;
}
