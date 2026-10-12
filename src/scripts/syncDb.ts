import { sequelize } from '../config/database';
import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';
import { BookPurpose, TransactionState } from '../models';
import type { LookupDefinition, LookupRow } from '../types';
import { runMigrations } from './migrate';

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

DROP TABLE IF EXISTS public.schema_migration CASCADE;

DROP FUNCTION IF EXISTS public.forbid_change() CASCADE;

`;

async function main(): Promise<void> {
  try {
    console.log('DROP ALL TABLE CASADE');
    await sequelize.query(sql);

    await sequelize.authenticate();

    console.log('Running migrations...');

    const report = await runMigrations();

    console.log(`Migrations applied: ${report.applied.join(', ') || 'none'}`);

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
