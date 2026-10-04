import type { Book } from '../models';
import type { AccountAssetIdentity } from './account';
import type { CreatedByParams, GetOrCreateResult, HistoryRecordParams, UpdatedByParams } from './common';

export interface BookRef {
  bookPurposeId: number;
  transactionStateId: number | null;
}

export interface BookParams extends AccountAssetIdentity, BookRef, CreatedByParams {
  name?: string;
  address?: string;
}

export type GetOrCreateBookResult = GetOrCreateResult<{ book: Book }>;

export interface UpdateBookParams extends UpdatedByParams {
  book: Book;
  amountDelta: string;
  sequenceNo: string;
  bookPostingId?: string | null;
}

export interface RecordBookHistoryParams extends HistoryRecordParams {
  bookId: number;
  bookPostingId?: string | null;

  amount: string;
  lastSequenceNo: string;
}
