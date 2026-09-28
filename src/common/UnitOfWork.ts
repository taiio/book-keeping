import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { sequelize } from '../config/database';
import { IUnitOfWork } from '../interfaces';

/**
 * UnitOfWork bọc toàn bộ 1 "business command" trong đúng 1 DB transaction, để mọi
 * repository (JournalTransaction/Book/BookPosting + 2 bảng history) cùng commit hoặc cùng rollback.
 */
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
