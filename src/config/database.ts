import { Sequelize } from 'sequelize-typescript';

import { Book } from '../models/Book';
import { BookHistory } from '../models/BookHistory';
import { BookPosting } from '../models/BookPosting';
import { BookPurpose } from '../models/BookPurpose';
import { JournalTransaction } from '../models/JournalTransaction';
import { JournalTransactionHistory } from '../models/JournalTransactionHistory';
import { TransactionState } from '../models/TransactionState';

export const sequelize = new Sequelize({
  dialect: 'postgres',

  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5433),

  database: process.env.DB_NAME ?? 'bookkeeping',
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',

  models: [BookPurpose, TransactionState, JournalTransaction, JournalTransactionHistory, Book, BookPosting, BookHistory],

  logging: true,

  pool: {
    max: 20,
    min: 2,
    acquire: 30_000,
    idle: 10_000,
  },
});
