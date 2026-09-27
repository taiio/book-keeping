export interface GetOrCreateBookParams {
  /**
   * LƯU Ý: Book KHÔNG có cột idempotency_token — dedup dựa hoàn toàn vào
   * khoá tự nhiên (client_id, account_id, asset_type_id, wallet_type_id,
   * book_purpose_id, transaction_state_id), được enforce bởi
   * `idx_unique_book` ở DB. Field idempotencyToken từng bị truyền vào đây
   * (dưới dạng randomUUID() ở tầng flow) nhưng bị Sequelize âm thầm bỏ
   * qua vì Book model không có field này — đã bỏ khỏi interface để không
   * ai tưởng nhầm nó có tác dụng.
   */
  name: string;
  bookPurposeId: number;
  transactionStateId: number | null;
  clientId: number;
  accountId: number;
  assetId: number;
  assetTypeId: number;
  assetTicker: string;
  walletTypeId: number;
  address?: string | null;
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
