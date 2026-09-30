import type { CreatedByParams } from './common';

export interface CreateBookPostingParams extends CreatedByParams {
  bookId: number;
  journalTransactionId: number;

  amount: string;
  assetTypeId: number | null;
  bookPostingPurposeId: number;
  businessPostDateTime: Date;

  idempotencyToken: string;
}
