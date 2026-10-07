import { createLogger, errorMeta } from '../common/logger';
import { sequelize } from '../config/database';
import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';
import { BookPurpose, TransactionState } from '../models';
import type { LookupDefinition, LookupRow } from '../types';
import { POST_SYNC_SQL } from './postSyncSql';

const log = createLogger('syncDb');

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
    log.warn('dropping all ledger tables (CASCADE)');
    await sequelize.query(sql);

    log.info('syncing database schema');

    await sequelize.authenticate();

    await sequelize.sync({
      alter: false,
    });

    for (const statement of POST_SYNC_SQL) {
      await sequelize.query(statement);
    }

    log.info('database sync completed', { postSyncStatements: POST_SYNC_SQL.length });

    await seed();

    log.info('seed completed');
  } catch (error) {
    log.error('database sync/seed failed', errorMeta(error));
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

void main();
