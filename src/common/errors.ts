export class InsufficientBalanceError extends Error {
  constructor(bookId: number, currentAmount: string, delta: string) {
    super(`Insufficient book balance: book=${bookId}, current=${currentAmount}, delta=${delta}`);
    this.name = 'InsufficientBalanceError';
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: number | string) {
    super(`${entity} not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

/**
 * 1 request bị từ chối NGAY TỪ ĐẦU (chưa hề tạo JournalTransaction/posting nào)
 * vì thiếu số dư — có thể thiếu ở 1 hoặc CẢ 2 vế cùng lúc (vd amount dùng
 * assetType A, fee dùng assetType B khác, cả 2 đều không đủ). `shortfalls`
 * liệt kê đầy đủ TỪNG vế thiếu để caller/API trả lỗi rõ ràng 1 lần, thay vì
 * phải thử lại nhiều lần mới biết hết các vế bị thiếu.
 */
export class WithdrawRejectedError extends Error {
  constructor(public readonly shortfalls: string[]) {
    super(`Withdraw rejected — insufficient balance: ${shortfalls.join('; ')}`);
    this.name = 'WithdrawRejectedError';
  }
}

/**
 * 1 journal bị HUỶ (CANCELLED_OR_EXPIRED) vì có lệnh advance() cố nhảy SAI
 * THỨ TỰ state (bỏ bước, hoặc target không nằm trong chuỗi state hợp lệ của
 * flow/kind đang chạy). Journal đã được đánh dấu CANCELLED và (nếu flow có hỗ
 * trợ) đã được hoàn tiền lại cho client TRƯỚC KHI lỗi này được throw — caller
 * chỉ cần biết là request bị từ chối, không cần tự xử lý hoàn tiền.
 */
export class InvalidStateTransitionError extends Error {
  constructor(journalTransactionId: number, fromStateId: number | null, targetStateId: number) {
    super(
      `Invalid state transition for journal=${journalTransactionId}: from=${fromStateId ?? 'null'} -> target=${targetStateId}. Journal đã bị CANCELLED.`,
    );
    this.name = 'InvalidStateTransitionError';
  }
}
