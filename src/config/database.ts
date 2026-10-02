import { Sequelize } from 'sequelize-typescript';

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

export const sequelize = new Sequelize({
  dialect: 'postgres',

  host: env.db.host,
  port: env.db.port,

  database: env.db.name,
  username: env.db.user,
  password: env.db.password,

  models: [BookPurpose, TransactionState, JournalTransaction, JournalTransactionHistory, Book, BookPosting, BookHistory, InboxEvent, OutboxEvent],

  logging: env.db.logging ? console.log : false,

  pool: {
    max: env.db.poolMax,
    min: env.db.poolMin,
    acquire: env.db.poolAcquireMs,
    idle: env.db.poolIdleMs,
  },
});
