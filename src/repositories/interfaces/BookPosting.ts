export interface CreateBookPostingParams {
  bookId: number;
  journalTransactionId: number;
  /** Số tiền cộng/trừ vào book, có dấu. */
  amount: string;
  assetTypeId: number;
  bookPostingPurposeId: number;
  /** Idempotency của riêng posting này (nên gồm cả state, vd 'withdraw:42:authorized:client-quantity'). */
  idempotencyToken: string;
  historyTransactionTypeId: number;
  businessPostDateTime?: Date;
  createdBy?: number | null;
}
