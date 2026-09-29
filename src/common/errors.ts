export class InsufficientBalanceError extends Error {
  constructor(bookId: number, currentAmount: string, delta: string) {
    super(`Insufficient book balance: book=${bookId}, current=${currentAmount}, delta=${delta}`);
    this.name = 'InsufficientBalanceError';
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: number | string) {
    super(`${entity} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export class InvalidTransitionError extends Error {
  constructor(journalTransactionId: number, currentStateId: number | null, targetStateId: number) {
    super(`Invalid transition: journalTransaction=${journalTransactionId}, current=${currentStateId ?? 'NONE'}, target=${targetStateId}`);
    this.name = 'InvalidTransitionError';
  }
}

export class UnsupportedOperationError extends Error {
  constructor(message: string) {
    super(`Unsupported (happy-path only): ${message}`);
    this.name = 'UnsupportedOperationError';
  }
}
