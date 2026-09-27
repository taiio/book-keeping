import { Sequelize } from 'sequelize-typescript';

import { Book } from '../models/Book';
import { BookHistory } from '../models/BookHistory';
import { BookPosting } from '../models/BookPosting';
import { BookPurpose } from '../models/BookPurpose';
import { JournalTransaction } from '../models/JournalTransaction';
import { JournalTransactionHistory } from '../models/JournalTransactionHistory';
import { TransactionState } from '../models/TransactionState';
import { env } from './env';

export const sequelize = new Sequelize({
  dialect: 'postgres',

  host: env.db.host,
  port: env.db.port,

  database: env.db.name,
  username: env.db.user,
  password: env.db.password,

  models: [BookPurpose, TransactionState, JournalTransaction, JournalTransactionHistory, Book, BookPosting, BookHistory],

  logging: env.db.logging ? console.log : false,

  pool: {
    max: env.db.poolMax,
    min: env.db.poolMin,
    acquire: env.db.poolAcquireMs,
    idle: env.db.poolIdleMs,
  },
});
