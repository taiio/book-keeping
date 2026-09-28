import { sequelize } from '../src/config/database';
import { BookPurpose, TransactionState } from './models';
import { BOOK_PURPOSE, TRANSACTION_STATE } from './constants';

async function seedBookPurposes(): Promise<void> {
  for (const purpose of Object.values(BOOK_PURPOSE)) {
    await BookPurpose.upsert({
      id: purpose.id,
      code: purpose.code,
      name: purpose.name,
      description: purpose.description,
    });
  }
}

async function seedTransactionState(): Promise<void> {
  for (const transactionState of Object.values(TRANSACTION_STATE)) {
    await TransactionState.upsert({
      id: transactionState.id,
      code: transactionState.code,
      name: transactionState.name,
      description: transactionState.description,
    });
  }
}

async function seed(): Promise<void> {
  await seedBookPurposes();
  await seedTransactionState();
}

async function main(): Promise<void> {
  try {
    console.log('Syncing database...');

    await sequelize.authenticate();

    await sequelize.sync({
      alter: false,
    });

    console.log('Database sync completed successfully.');

    await seed();

    console.log('Seed completed successfully.');
  } catch (error) {
    console.error('Database sync/seed failed:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

void main();
