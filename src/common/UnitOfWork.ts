import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { sequelize } from '../config/database';

/**
 * UnitOfWork bọc toàn bộ 1 "business command" (createWithdrawal, confirmDeposit, ...)
 * trong đúng 1 DB transaction, để mọi repository (JournalTransaction/Book/BookPosting)
 * ghi dữ liệu + history cùng commit hoặc cùng rollback.
 */
export interface IUnitOfWork {
  execute<T>(work: (tx: Transaction) => Promise<T>, isolationLevel?: Transaction.ISOLATION_LEVELS): Promise<T>;
}

@singleton()
@autoInjectable()
export class UnitOfWork implements IUnitOfWork {
  async execute<T>(
    work: (tx: Transaction) => Promise<T>,
    isolationLevel: Transaction.ISOLATION_LEVELS = Transaction.ISOLATION_LEVELS.READ_COMMITTED,
  ): Promise<T> {
    return sequelize.transaction({ isolationLevel }, work);
  }
}
