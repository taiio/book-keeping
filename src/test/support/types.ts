import type { Transaction } from 'sequelize';

export interface TransactionalHandler<TPayload, TResult> {
  applyInTransaction(payload: TPayload, tx: Transaction): Promise<TResult>;
}

export interface DirectHandler<TPayload, TResult> {
  handle(payload: TPayload): Promise<TResult>;
}
