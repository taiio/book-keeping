import type { Transaction } from 'sequelize';

export interface IUnitOfWork {
  execute<T>(work: (tx: Transaction) => Promise<T>, isolationLevel?: Transaction.ISOLATION_LEVELS): Promise<T>;
}
