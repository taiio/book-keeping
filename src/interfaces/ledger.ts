import type { Book } from '../models';
import type { BookLeg, UpdateJournalTransaction } from './persistence';
import type { AccountItem, FeeItem } from './transaction';
import type { BookPostingPurposeId } from '../constants/bookPostingPurpose';
import type { TransactionStateId } from '../constants/transactionState';
import { BlockchainTransactionStatus } from '../constants/blockchainTransactionStatus';

export type LegItem = AccountItem | FeeItem;

export interface AccountingLegs {
  /**
   * Tài sản RỜI custody:
   * Available -> Reserved -> Authorized -> Sent -> Confirming
   * rồi ra External ở CONFIRMED.
   */
  debitItems: AccountItem[];

  /**
   * Tài sản VÀO custody:
   * settle từ External về custody ở CONFIRMED.
   * Chỉ UNSTAKE dùng.
   */
  creditItems: AccountItem[];

  fee: FeeItem;
}

export interface LegMovement {
  /**
   * Stable identifier of the movement within the transaction.
   */
  key: string;

  item: LegItem;

  purposeId: BookPostingPurposeId;
}

export interface MovementSpec extends LegMovement {
  fromLeg: BookLeg;
  toLeg: BookLeg;
}

export interface ResolvedBooks {
  fromBook: Book;
  toBook: Book;
}

/**
 * Common data required by a ledger operation.
 *
 * uuidToken is the base transaction UUID.
 *
 * The final idempotency token is derived from:
 *
 *   uuidToken + transactionType + transactionState + index
 */
export interface LedgerOperation {
  journalTransactionId: number;

  uuidToken: string;

  legs: AccountingLegs;

  createdBy?: number;
}

/**
 * LedgerOperation + source/destination transaction states
 * used by ADVANCE / RELEASE / SETTLE.
 */
export interface BucketMove extends LedgerOperation {
  /**
   * State of the journal BEFORE the transition.
   *
   * This identifies the source bucket.
   *
   * Every transaction state has its own bucket,
   * including AUTHORIZING = Reserved.
   */
  fromStateId: TransactionStateId;

  /**
   * Destination state for ADVANCE.
   *
   * Not used by RELEASE:
   *   previous bucket -> Available
   *
   * Not used by SETTLE:
   *   Confirming -> External
   */
  toStateId?: TransactionStateId;
}

export type ReserveResult = { ok: true } | { ok: false; shortfalls: string[] };

/**
 * Double-entry movement of a DEPOSIT.
 *
 * The custody book is already known from deposit detection.
 * Confirming / External books are derived from that book.
 */
export interface DepositMovement {
  journalTransactionId: number;

  uuidToken: string;

  matchedCustodyBook: Book;

  quantity: string;

  createdBy?: number;
}

/**
 * Accounting phases of a DEPOSIT:
 *
 * CONFIRMING:
 *   External -> Confirming
 *
 * CONFIRMED:
 *   Confirming -> Available
 *
 * FAILED:
 *   Confirming -> External
 */
export type DepositPhase = BlockchainTransactionStatus;

export interface ApplyMovement {
  fromBook: Book;

  toBook: Book;

  quantity: string;

  purposeId: BookPostingPurposeId;

  journalTransactionId: number;

  /**
   * Stable movement identifier.
   *
   * Used as the deterministic index/key when
   * generating the idempotency token.
   */
  movementKey: string;

  createdBy?: number;
}

/**
 * Accounting effect executed when a journal state
 * transition succeeds with outcome = APPLIED.
 *
 * ADVANCE:
 *   bucket(previous state) -> bucket(new state)
 *
 * SETTLE:
 *   CONFIRMED:
 *     Confirming -> External (amount)
 *     Confirming -> Fee Confirming -> Fee Revenue (fee)
 *
 * RELEASE:
 *   FAILED / REJECTED:
 *     bucket(previous state) -> Available
 */
export const LEDGER_PHASE = {
  ADVANCE: 'ADVANCE',
  SETTLE: 'SETTLE',
  RELEASE: 'RELEASE',
} as const;

export type LedgerPhase = (typeof LEDGER_PHASE)[keyof typeof LEDGER_PHASE];
export interface Transition extends UpdateJournalTransaction {
  /**
   * Original transaction legs.
   *
   * Required when onApplied needs to execute an
   * accounting operation.
   *
   * null means the source content is missing or
   * cannot be reconstructed.
   */
  legs?: AccountingLegs | null;

  /**
   * Accounting effect executed only when the
   * transition outcome is APPLIED.
   */
  onApplied?: LedgerPhase;
}
