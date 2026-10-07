import { Sequelize } from 'sequelize-typescript';

import { createLogger } from '../common/logger';

import {
  BookHistory,
  Book,
  BookPosting,
  BookPurpose,
  InboxEvent,
  JournalTransaction,
  JournalTransactionHistory,
  OutboxEvent,
  TransactionState,
} from '../models';
import { env } from './env';

const log = createLogger('sql');

const MAX_SQL_LENGTH = 1_000;

function logSql(sql: string): void {
  const text = sql.replace(/^Executing \([^)]*\):\s*/, '');

  log.debug(text.length > MAX_SQL_LENGTH ? `${text.slice(0, MAX_SQL_LENGTH)}… (+${text.length - MAX_SQL_LENGTH} chars)` : text);
}

export const sequelize = new Sequelize({
  dialect: 'postgres',

  host: env.db.host,
  port: env.db.port,

  database: env.db.name,
  username: env.db.user,
  password: env.db.password,

  models: [BookPurpose, TransactionState, JournalTransaction, JournalTransactionHistory, Book, BookPosting, BookHistory, InboxEvent, OutboxEvent],

  logging: env.db.logging ? logSql : false,

  pool: {
    max: env.db.poolMax,
    min: env.db.poolMin,
    acquire: env.db.poolAcquireMs,
    idle: env.db.poolIdleMs,
  },
});
