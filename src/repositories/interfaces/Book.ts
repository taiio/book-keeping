export interface GetOrCreateBookParams {
  /** Khoá idempotency thật sự (không phải suy ra từ "name") — retry-safe. */
  idempotencyToken: string;
  name: string;
  bookPurposeId: number;
  transactionStateId: number;
  clientId: number;
  accountId: number;
  assetId: number;
  assetTypeId: number;
  assetTicker: string;
  walletTypeId: number;
  address?: string | null;
  amount: string;
  createdBy?: number | null;
}

export interface GetOrCreateBookResult {
  book: import('../../models').Book;
  created: boolean;
}

export interface UpdateBookParams {
  /**
   * Book instance ĐÃ được khoá (SELECT ... FOR UPDATE) trong transaction hiện tại,
   * thường lấy từ lockBookById(). updateBook không tự khoá lại để tránh 1 nghiệp vụ
   * phải lock cùng 1 row 2 lần.
   */
  book: import('../../models').Book;
  /** Số tiền cộng/trừ, có dấu. Vd: '-100' hoặc '100'. */
  amountDelta: string;
  /** Sequence tiếp theo của book (thường do BookPostingRepository tính trước). */
  sequenceNo: number;
  bookPostingId?: number | null;
  transactionStateId?: number;
  historyTransactionTypeId: number;
  updatedBy?: number | null;
}
