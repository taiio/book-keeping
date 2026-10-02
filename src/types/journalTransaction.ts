import type { JournalTransactionStateId } from '../constants';
import type { JournalTransaction } from '../models';
import type { CreatedByParams, GetOrCreateResult, HistoryRecordParams, UpdatedByParams } from './common';

export interface GetOrCreateJournalTransactionParams extends CreatedByParams {
  idempotencyToken: string;
  uuidToken: string;
  transactionTypeId: number;

  transactionStateId?: number | null;
  transactionHash?: string | null;
  sourceContent?: string | null;
  fromAccountId?: number | null;
  toAccountId?: number | null;
  businessPostDateTime?: Date;
}

export type GetOrCreateJournalTransactionResult = GetOrCreateResult<{ journalTransaction: JournalTransaction }>;

export interface UpdateJournalTransactionParams extends UpdatedByParams {
  journalTransactionId: number;

  journalTransactionState?: JournalTransactionStateId;
}

export interface RecordJournalTransactionHistoryParams extends HistoryRecordParams {
  journalTransaction: JournalTransaction;

  transactionStateId?: number | null;
}
