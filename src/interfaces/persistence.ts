import type { Transaction as SequelizeTransaction } from 'sequelize';

import type { Book, JournalTransaction } from '../models';
import type { JournalTransactionStateValue } from './transaction';
import type { BookPurposeId } from '../constants/bookPurpose';
import type { BookPostingPurposeId } from '../constants/bookPostingPurpose';
import type { TransactionStateId, TransactionStateCode } from '../constants/transactionState';
import type { TransactionType } from '../constants/transactionType';

// ----------------------------------------------------------------------
// Unit of work
// ----------------------------------------------------------------------

/**
 * Wraps one business command in a single DB transaction.
 *
 * All repository writes and history records are committed
 * or rolled back together.
 */
export interface IUnitOfWork {
  execute<T>(work: (tx: SequelizeTransaction) => Promise<T>, isolationLevel?: SequelizeTransaction.ISOLATION_LEVELS): Promise<T>;
}

// ----------------------------------------------------------------------
// Book / BookPosting / BookHistory
// ----------------------------------------------------------------------

/**
 * Identity and attributes required to get-or-create a Book.
 *
 * The unique identity is enforced by the database
 * through idx_unique_book.
 */
export interface BookLeg {
  name?: string;

  clientId: number;

  accountId: number;

  assetId: number;

  assetTypeId: number;

  assetTicker: string;

  walletTypeId: number;

  bookPurposeId: BookPurposeId;

  /**
   * null means the book does not belong to a
   * transaction-state bucket.
   */
  transactionStateId: TransactionStateId | null;

  address?: string;

  createdBy?: number;
}

export interface GetOrCreateBookResult {
  book: Book;

  created: boolean;
}

/**
 * Updates a Book that has already been locked with FOR UPDATE
 * within the same DB transaction.
 */
export interface UpdateBook {
  book: Book;

  amountDelta: string;

  sequenceNo: number;

  bookPostingId?: number | null;

  updatedBy?: number | null;
}

/**
 * Creates one immutable BookPosting.
 *
 * amount:
 *   negative -> decrease book balance
 *   positive -> increase book balance
 *
 * idempotencyToken:
 *   Repeating the same token must be a no-op.
 */
export interface CreateBookPosting {
  bookId: number;

  journalTransactionId: number;

  amount: string;

  assetTypeId: number | null;

  bookPostingPurposeId: BookPostingPurposeId;

  businessPostDateTime: Date;

  /**
   * Deterministic idempotency key for this accounting operation.
   *
   * Format:
   *
   *   transactionUuid:transactionType:transactionState:index
   */
  idempotencyToken: string;

  createdBy?: number;
}

/**
 * Records a snapshot of a Book after an event.
 */
export interface RecordBookHistory {
  /**
   * HISTORY_EVENT_TYPE.CREATED
   * or
   * HISTORY_EVENT_TYPE.POSTING_APPLIED.
   */
  historyTransactionTypeId: number;

  bookId: number;

  bookPostingId?: number | null;

  /**
   * Book balance AFTER this event.
   * This is a snapshot, not a delta.
   */
  amount: string;

  lastSequenceNo: number;

  createdBy?: number | null;
}

// ----------------------------------------------------------------------
// JournalTransaction / JournalTransactionHistory
// ----------------------------------------------------------------------

/**
 * Data required to get-or-create a JournalTransaction.
 */
export interface GetOrCreateJournalTransaction {
  /**
   * If omitted, a new JournalTransaction is always created.
   *
   * A null token must NOT be used to merge transactions.
   */
  idempotencyToken?: string | null;

  /**
   * Original business transaction UUID.
   */
  uuidToken: string;

  transactionTypeId: TransactionType;

  transactionStateId?: TransactionStateId | null;

  transactionHash?: string | null;

  /**
   * Original payload stored as JSON.
   *
   * BlockchainEventHandler uses this to correlate
   * blockchain events and reconstruct legs for
   * settlement/release.
   */
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

/**
 * Input for changing a JournalTransaction state.
 */
export interface UpdateJournalTransaction {
  journalTransactionId: number;

  transactionHash?: string;

  /**
   * State requested by the caller.
   */
  targetTransactionStateId?: TransactionStateId;

  /**
   * Optional expected state sequence used to enforce
   * the FSM strictly.
   *
   * Example:
   *
   * AUTHORIZING -> AUTHORIZED
   * AUTHORIZED  -> SENT
   * SENT        -> CONFIRMING
   * CONFIRMING  -> CONFIRMED
   */
  expectedStateSequence?: readonly TransactionStateId[];

  /**
   * Journal processing state.
   *
   * If omitted, the current journal state is preserved.
   */
  journalTransactionState?: JournalTransactionStateValue;

  updatedBy?: number;
}

/**
 * Result of a JournalTransaction state transition.
 *
 * APPLIED:
 *   The requested transition is valid.
 *   Journal state is updated and history is recorded.
 *
 * REPLAYED_NOOP:
 *   The event was already processed, duplicated, late,
 *   or the journal is already in a terminal state.
 *   No state or accounting change is applied.
 *
 * REJECTED_INVALID_TRANSITION:
 *   The requested transition is not allowed by the FSM.
 *   No state or accounting change is applied.
 */
export type JournalTransitionOutcome = 'APPLIED' | 'REPLAYED_NOOP' | 'REJECTED_INVALID_TRANSITION';

export interface UpdateJournalTransactionResult {
  journalTransaction: JournalTransaction;

  outcome: JournalTransitionOutcome;

  /**
   * Transaction state BEFORE the transition.
   *
   * This is the source bucket from which the accounting
   * effect must deduct funds.
   */
  previousTransactionStateId: TransactionStateId | null;
}

/**
 * Creates a JournalTransactionHistory record.
 *
 * The history stores the JournalTransaction snapshot
 * AFTER the event.
 */
export interface RecordJournalTransactionHistory {
  /**
   * JournalTransaction state AFTER the event.
   */
  journalTransaction: JournalTransaction;

  historyTransactionTypeId: number;

  createdBy?: number | null;
}
