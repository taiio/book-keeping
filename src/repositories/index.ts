export { BookRepository } from './Book';
export { BookPostingRepository } from './BookPosting';
export { JournalTransactionRepository } from './JournalTransaction';

export type {
  GetOrCreateBookParams,
  GetOrCreateBookResult,
  UpdateBookParams,
  CreateBookPostingParams,
  GetOrCreateJournalTransactionParams,
  GetOrCreateJournalTransactionResult,
  UpdateJournalTransactionParams,
} from './interfaces';
