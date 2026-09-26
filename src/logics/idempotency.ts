/**
 * Build idempotency token cho 1 leg posting.
 *
 * Format: `{idempotencyToken}-{transactionTypeId}-{transactionStateId}-{bookPostingPurposeId}-{legIndex}`
 *
 * Deterministic theo request.idempotencyToken -> gọi lại (duplicate event,
 * retry) luôn tính ra ĐÚNG token cũ, để BookPostingRepository.createBookPosting
 * (dựa vào unique constraint DB trên idempotency_token + lock-book-trước)
 * nhận diện đúng đây là bản ghi trùng và không áp dụng số dư lần 2.
 *
 * `legIndex` dùng để phân biệt 2 vế của cùng 1 bước (vd vế trừ tiền / vế cộng
 * tiền trong cùng 1 lần chuyển) khi (transactionTypeId, transactionStateId,
 * bookPostingPurposeId) giống nhau; nếu purpose đã khác (vd AMOUNT vs FEE) thì
 * legIndex có thể trùng nhau mà token vẫn không đụng nhau.
 */
export function buildPostingIdempotencyToken(params: {
  idempotencyToken: string;
  transactionTypeId: number;
  transactionStateId: number;
  bookPostingPurposeId: number;
  legIndex: number;
}): string {
  return `${params.idempotencyToken}-${params.transactionTypeId}-${params.transactionStateId}-${params.bookPostingPurposeId}-${params.legIndex}`;
}
