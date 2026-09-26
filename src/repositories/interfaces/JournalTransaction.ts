export interface GetOrCreateJournalTransactionParams {
  idempotencyToken: string;
  uuidToken: string;
  transactionTypeId: number;
  fromAccountId?: number | null;
  toAccountId?: number | null;
  transactionHash?: string | null;
  createdBy?: number | null;
  /** journal_transaction_state ghi vào JournalTransaction + JournalTransactionHistory lúc tạo (vd ACTIVE). */
  journalTransactionState: string | null;
  /**
   * State chi tiết BAN ĐẦU của vòng đời nghiệp vụ (vd TRANSACTION_STATE.AUTHORIZING.id
   * cho withdraw/stake, TRANSACTION_STATE.CONFIRMING.id cho deposit). Nullable vì không
   * phải flow nào cũng cần granularity này.
   */
  transactionStateId?: number | null;
  historyTransactionTypeId: number | null;
  businessPostDateTime: Date;
}

export interface GetOrCreateJournalTransactionResult {
  journalTransaction: import('../../models').JournalTransaction;
  created: boolean;
}

export interface UpdateJournalTransactionParams {
  journalTransactionId: number;
  /** journal_transaction_state ghi vào JournalTransactionHistory (vd ACTIVE/COMPLETED). */
  journalTransactionState: string;
  historyTransactionTypeId: number;
  transactionHash?: string | null;
  updatedBy?: number | null;
  /**
   * State chi tiết ĐÍCH của lần advance này (vd TRANSACTION_STATE.SENT.id).
   * Khi có giá trị, updateJournalTransaction sẽ:
   *   1. So sánh rank với transactionStateId hiện tại của journal (guard monotonic) —
   *      nếu target <= hiện tại thì coi là replay/late event, trả về nguyên trạng.
   *   2. Cập nhật cột cache journal_transaction.transaction_state_id.
   *   3. Ghi transaction_state_id này vào dòng JournalTransactionHistory tương ứng
   *      (snapshot tại đúng thời điểm sự kiện, không phải cache).
   */
  targetTransactionStateId?: number | null;
  /** Đánh dấu journal_transaction_state = COMPLETED khi đạt state cuối cùng. */
  completeJournal?: boolean;
  /** Đánh dấu journal_transaction_state = CANCELLED_OR_EXPIRED. */
  cancelJournal?: boolean;
}
