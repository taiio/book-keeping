/**
 * How a consumer should react to a failure:
 *  - `retryable`    : transient or ordering related, safe to redeliver later (deadlock, event arrived too early).
 *  - `non_retryable`: the message itself is wrong; retrying cannot help (invalid transition, amount mismatch).
 */
export type ErrorDisposition = 'retryable' | 'non_retryable';

export abstract class LedgerError extends Error {
  abstract readonly disposition: ErrorDisposition;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }

  get retryable(): boolean {
    return this.disposition === 'retryable';
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof LedgerError && error.retryable;
}

export class ValidationError extends LedgerError {
  readonly disposition = 'non_retryable';
}

export class UnsupportedOperationError extends LedgerError {
  readonly disposition = 'non_retryable';

  constructor(message: string) {
    super(`Unsupported operation: ${message}`);
  }
}

export class NotFoundError extends LedgerError {
  readonly disposition = 'non_retryable';

  constructor(entity: string, id: number | string) {
    super(`${entity} not found: ${id}`);
  }
}

export class InsufficientBalanceError extends LedgerError {
  readonly disposition = 'non_retryable';

  constructor(bookId: number, currentAmount: string, delta: string) {
    super(`Insufficient book balance: book=${bookId}, current=${currentAmount}, delta=${delta}`);
  }
}

export class InvalidTransitionError extends LedgerError {
  readonly disposition = 'non_retryable';

  constructor(journalTransactionId: number, currentStateId: number | null, targetStateId: number) {
    super(`Invalid transition: journalTransaction=${journalTransactionId}, current=${currentStateId ?? 'NONE'}, target=${targetStateId}`);
  }
}

/** The event arrived before the state(s) it depends on. Safe to redeliver; an inbox can park it. */
export class TransitionNotReadyError extends LedgerError {
  readonly disposition = 'retryable';

  constructor(journalTransactionId: number | string, currentStateId: number | null, targetStateId: number) {
    super(`Transition not ready: journalTransaction=${journalTransactionId}, current=${currentStateId ?? 'NONE'}, target=${targetStateId}`);
  }
}

export class AmountMismatchError extends LedgerError {
  readonly disposition = 'non_retryable';

  constructor(journalTransactionId: number, purposeId: number, expected: bigint, actual: bigint) {
    super(`Amount mismatch: journalTransaction=${journalTransactionId}, purpose=${purposeId}, held=${expected}, received=${actual}`);
  }
}

export class FeeExceedsEstimationError extends LedgerError {
  readonly disposition = 'non_retryable';

  constructor(journalTransactionId: number, estimated: bigint, actual: bigint) {
    super(`Real fee exceeds estimation: journalTransaction=${journalTransactionId}, estimated=${estimated}, real=${actual}`);
  }
}

/** The same idempotency token was reused with different content. */
export class IdempotencyConflictError extends LedgerError {
  readonly disposition = 'non_retryable';

  constructor(token: string, detail: string) {
    super(`Idempotency conflict: token=${token}, ${detail}`);
  }
}

/** A transaction hash is write-once; a different hash means the payload changed. */
export class TransactionHashConflictError extends LedgerError {
  readonly disposition = 'non_retryable';

  constructor(journalTransactionId: number, existing: string, incoming: string) {
    super(`Transaction hash conflict: journalTransaction=${journalTransactionId}, existing=${existing}, incoming=${incoming}`);
  }
}
