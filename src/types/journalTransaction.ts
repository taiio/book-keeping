import type { JournalTransaction } from '../models';
import type { CreatedByParams, GetOrCreateResult, HistoryRecordParams } from './common';

export interface GetOrCreateJournalTransactionParams extends CreatedByParams {
  idempotencyToken: string;
  uuidToken: string;
  transactionTypeId: number;

  transactionStateId?: number | null;
  transactionHash?: string | null;
  fromAccountId?: number | null;
  toAccountId?: number | null;
  businessPostDateTime?: Date;
}

export type GetOrCreateJournalTransactionResult = GetOrCreateResult<{ journalTransaction: JournalTransaction }>;

export interface RecordJournalTransactionHistoryParams extends HistoryRecordParams {
  journalTransaction: JournalTransaction;

  transactionStateId?: number | null;
}
