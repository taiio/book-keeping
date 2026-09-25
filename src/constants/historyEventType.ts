export const HISTORY_EVENT_TYPE = {
  CREATED: 1,
  STATE_ADVANCED: 2,
  POSTING_APPLIED: 3,
} as const;

/**
 * Defines the types of events recorded in the transaction history.
 *
 * These values describe what happened during the lifecycle of a transaction,
 * rather than what type of transaction it is. They are used to maintain an
 * audit trail so that the system can track when a transaction was created,
 * when its state changed, and when ledger postings were applied to books.
 *
 * CREATED:
 * Records the initial creation of the transaction. This establishes the
 * starting point of the transaction lifecycle and provides an audit record
 * of when the transaction first entered the system.
 *
 * STATE_ADVANCED:
 * Records a state transition during the transaction lifecycle. For example,
 * a blockchain withdrawal may move from AUTHORIZING to AUTHORIZED, then to
 * SENT, CONFIRMING, and finally CONFIRMED. Each transition can be recorded
 * in the history to provide a complete and traceable state-change timeline.
 *
 * POSTING_APPLIED:
 * Records when a book posting is applied to a book and affects its balance.
 * This provides an audit trail connecting the journal transaction to the
 * corresponding ledger balance changes. For example, a deposit may create
 * postings for both the external account book and the client asset account
 * book.
 */
