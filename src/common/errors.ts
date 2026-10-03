import { ERROR_DISPOSITION } from '../constants';
import type { ErrorDisposition } from '../constants';

export abstract class LedgerError extends Error {
  abstract readonly disposition: ErrorDisposition;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }

  get retryable(): boolean {
    return this.disposition === ERROR_DISPOSITION.RETRYABLE;
  }
}

export function isRetryable(error: unknown): boolean {
  return error instanceof LedgerError && error.retryable;
}

export class ValidationError extends LedgerError {
  readonly disposition = ERROR_DISPOSITION.NON_RETRYABLE;
}

export class UnsupportedOperationError extends LedgerError {
  readonly disposition = ERROR_DISPOSITION.NON_RETRYABLE;

  constructor(message: string) {
    super(`Unsupported operation: ${message}`);
  }
}

export class NotFoundError extends LedgerError {
  readonly disposition = ERROR_DISPOSITION.NON_RETRYABLE;

  constructor(entity: string, id: number | string) {
    super(`${entity} not found: ${id}`);
  }
}

export class InsufficientBalanceError extends LedgerError {
  readonly disposition = ERROR_DISPOSITION.NON_RETRYABLE;

  constructor(bookId: number, currentAmount: string, delta: string) {
    super(`Insufficient book balance: book=${bookId}, current=${currentAmount}, delta=${delta}`);
  }
}

export class InvalidTransitionError extends LedgerError {
  readonly disposition = ERROR_DISPOSITION.NON_RETRYABLE;

  constructor(journalTransactionId: number, currentStateId: number | null, targetStateId: number) {
    super(`Invalid transition: journalTransaction=${journalTransactionId}, current=${currentStateId ?? 'NONE'}, target=${targetStateId}`);
  }
}

export class TransitionNotReadyError extends LedgerError {
  readonly disposition = ERROR_DISPOSITION.RETRYABLE;

  constructor(reference: number | string, currentStateId: number | null, targetStateId: number, reason?: string) {
    super(`Transition not ready: reference=${reference}, current=${currentStateId ?? 'NONE'}, target=${targetStateId}${reason ? `, reason=${reason}` : ''}`);
  }
}

export class AmountMismatchError extends LedgerError {
  readonly disposition = ERROR_DISPOSITION.NON_RETRYABLE;

  constructor(journalTransactionId: number, purposeId: number, expected: bigint, actual: bigint) {
    super(`Amount mismatch: journalTransaction=${journalTransactionId}, purpose=${purposeId}, held=${expected}, received=${actual}`);
  }
}

export class FeeExceedsEstimationError extends LedgerError {
  readonly disposition = ERROR_DISPOSITION.NON_RETRYABLE;

  constructor(journalTransactionId: number, estimated: bigint, actual: bigint) {
    super(`Real fee exceeds estimation: journalTransaction=${journalTransactionId}, estimated=${estimated}, real=${actual}`);
  }
}

export class IdempotencyConflictError extends LedgerError {
  readonly disposition = ERROR_DISPOSITION.NON_RETRYABLE;

  constructor(token: string, detail: string) {
    super(`Idempotency conflict: token=${token}, ${detail}`);
  }
}

export class TransactionHashConflictError extends LedgerError {
  readonly disposition = ERROR_DISPOSITION.NON_RETRYABLE;

  constructor(journalTransactionId: number, existing: string, incoming: string) {
    super(`Transaction hash conflict: journalTransaction=${journalTransactionId}, existing=${existing}, incoming=${incoming}`);
  }
}
