import type { Book } from '../models';
import type { CreatedByParams } from './common';

export interface CreateBookPostingParams extends CreatedByParams {
  bookId: number;
  journalTransactionId: number;

  amount: string;
  assetTypeId: number | null;
  bookPostingPurposeId: number;
  businessPostDateTime: Date;

  idempotencyToken: string;

  /** A book already locked by the caller; avoids locking (and re-reading) it again. */
  lockedBook?: Book;
}
