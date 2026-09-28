/**
 * Defines the types of events recorded in the history tables
 * (`journal_transaction_history` and `book_history`).
 *
 * These values describe WHAT HAPPENED, not the current state of a
 * transaction, journal, or book.
 *
 * CREATED:
 * The initial creation of a record.
 *
 * - `journal_transaction_history`: written when a JournalTransaction is created.
 * - `book_history`: written when a Book is created, with amount = 0 and no posting.
 *
 * STATE_ADVANCED:
 * A valid state transition during the journal transaction lifecycle.
 *
 * Examples:
 * AUTHORIZING -> AUTHORIZED
 * AUTHORIZED  -> SENT
 * SENT        -> CONFIRMING
 * CONFIRMING  -> CONFIRMED
 *
 * This event is written to `journal_transaction_history` only.
 *
 * POSTING_APPLIED:
 * A BookPosting was successfully applied to a Book and changed its balance.
 *
 * This event is written to `book_history` only and is linked to the
 * corresponding posting through `book_posting_id`.
 *
 * REJECTED_INVALID_TRANSITION:
 * An attempted state transition violated the defined transaction lifecycle,
 * such as skipping a required state or moving to an invalid state.
 *
 * This event is written to `journal_transaction_history` for audit purposes.
 * The JournalTransaction may transition to REJECTED according to the
 * journal transaction state rules.
 */
export const HISTORY_EVENT_TYPE = {
  CREATED: 1,
  STATE_ADVANCED: 2,
  POSTING_APPLIED: 3,
  REJECTED_INVALID_TRANSITION: 4,
} as const;

export type HistoryEventType = (typeof HISTORY_EVENT_TYPE)[keyof typeof HISTORY_EVENT_TYPE];
