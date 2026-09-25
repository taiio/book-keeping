export interface GetOrCreateJournalTransactionParams {
  idempotencyToken: string;
  uuidToken: string;
  transactionTypeId: number;
  fromAccountId?: number | null;
  toAccountId?: number | null;
  transactionHash?: string | null;
  createdBy?: number | null;
  /** journal_transaction_state_id ghi vào JournalTransactionHistory lúc tạo (vd AUTHORIZING = 1). */
  journalTransactionState: string | null;
  historyTransactionTypeId: number | null;
  businessPostDateTime: Date;
}

export interface GetOrCreateJournalTransactionResult {
  journalTransaction: import('../../models').JournalTransaction;
  created: boolean;
}

export interface UpdateJournalTransactionParams {
  journalTransactionId: number;
  /** transaction_state_id đích (vd TRANSACTION_STATE.CONFIRMED.id). */
  journalTransactionState: string;
  historyTransactionTypeId: number;
  transactionHash?: string | null;
  updatedBy?: number | null;
  /** Đánh dấu journal_transaction_state = COMPLETED khi đạt state cuối cùng. */
  completeJournal?: boolean;
  /** Đánh dấu journal_transaction_state = CANCELLED_OR_EXPIRED. */
  cancelJournal?: boolean;
}
