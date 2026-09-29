import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { sequelize } from '../config/database';
import { IUnitOfWork } from '../interfaces';

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
