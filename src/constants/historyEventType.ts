/**
 * Defines the types of events recorded in the history tables
 * (`journal_transaction_history` and `book_history`).
 *
 * These values describe WHAT HAPPENED, not what type of transaction it is. They
 * keep an audit trail of when a journal/book was created, when a journal state
 * changed, and when ledger postings were applied to books.
 *
 * CREATED:
 * The initial creation of a record. Written to `journal_transaction_history`
 * when a JournalTransaction is created, and to `book_history` (amount = 0,
 * no posting) when a Book is created.
 *
 * STATE_ADVANCED:
 * A state transition during the journal lifecycle, e.g. AUTHORIZING -> AUTHORIZED
 * -> SENT -> CONFIRMING -> CONFIRMED, or a move to CANCELLED_OR_EXPIRED. Written
 * to `journal_transaction_history` only.
 *
 * POSTING_APPLIED:
 * A BookPosting was applied to a Book and changed its balance. Written to
 * `book_history` only, linked to the posting through `book_posting_id`.
 *
 * REJECTED_INVALID_TRANSITION:
 * A state transition that skipped a step / was out of sequence. The journal is
 * cancelled and this event is written to `journal_transaction_history` only.
 */
export const HISTORY_EVENT_TYPE = {
  CREATED: 1,
  STATE_ADVANCED: 2,
  POSTING_APPLIED: 3,
  REJECTED_INVALID_TRANSITION: 4,
} as const;
