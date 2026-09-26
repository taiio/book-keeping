export class InsufficientBalanceError extends Error {
  constructor(bookId: number, currentAmount: string, delta: string) {
    super(`Insufficient book balance: book=${bookId}, current=${currentAmount}, delta=${delta}`);
    this.name = 'InsufficientBalanceError';
  }
}

export class InvalidStateTransitionError extends Error {
  constructor(currentStateId: number | null, targetState: string) {
    const current = currentStateId == null ? 'UNKNOWN' : String(currentStateId);
    super(`Invalid state transition: current=${current}, target=${targetState}`);
    this.name = 'InvalidStateTransitionError';
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: number | string) {
    super(`${entity} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}
