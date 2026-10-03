import type { Book } from '../models';
import type { CreatedByParams } from './common';

export interface PostingTokenParts {
  journalIdempotencyToken: string;
  transactionTypeId: number;
  transactionStateId: number;
  attempt: number;
  index: number;
}

export interface CreateBookPostingParams extends CreatedByParams {
  bookId: number;
  journalTransactionId: number;

  amount: string;
  assetTypeId: number | null;
  bookPostingPurposeId: number;
  businessPostDateTime: Date;

  idempotencyToken: string;

  lockedBook?: Book;
}
