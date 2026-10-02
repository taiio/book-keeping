import { sequelize } from '../config/database';
import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';
import { BookPurpose, TransactionState } from '../models';
import { POST_SYNC_SQL } from './postSyncSql';

/** Shape shared by the constant definitions that are seeded into a lookup table (book_purpose, transaction_state). */
interface LookupDefinition {
  readonly id: number | null;
  readonly code: string | null;
  readonly name: string;
  readonly description: string;
}

type LookupRow = {
  id: number;
  code: string;
  name: string;
  description: string;
};

async function seedLookupTable(definitions: readonly LookupDefinition[], upsert: (row: LookupRow) => Promise<unknown>): Promise<void> {
  for (const { id, code, name, description } of definitions) {
    if (!id || !code) continue;

    await upsert({ id, code, name, description });
  }
}

async function seed(): Promise<void> {
  await seedLookupTable(Object.values(BOOK_PURPOSE), (row) => BookPurpose.upsert(row));
  await seedLookupTable(Object.values(TRANSACTION_STATE), (row) => TransactionState.upsert(row));
}

const sql = `
DROP TABLE IF EXISTS public.book CASCADE;

DROP TABLE IF EXISTS public.book_history CASCADE;

DROP TABLE IF EXISTS public.book_posting CASCADE;

DROP TABLE IF EXISTS public.book_purpose CASCADE;

DROP TABLE IF EXISTS public.journal_transaction CASCADE;

DROP TABLE IF EXISTS public.journal_transaction_history CASCADE;

DROP TABLE IF EXISTS public.transaction_state CASCADE;

DROP TABLE IF EXISTS public.inbox_event CASCADE;

DROP TABLE IF EXISTS public.outbox_event CASCADE;

`;

async function main(): Promise<void> {
  try {
    console.log('DROP ALL TABLE CASADE');
    await sequelize.query(sql);

    console.log('Syncing database...');

    await sequelize.authenticate();

    await sequelize.sync({
      alter: false,
    });

    for (const statement of POST_SYNC_SQL) {
      await sequelize.query(statement);
    }

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
