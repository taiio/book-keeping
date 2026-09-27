/**
 * Build idempotency token cho 1 leg posting.
 *
 * Format: `{idempotencyToken}-{transactionTypeId}-{transactionStateIdOrZero}-{bookPostingPurposeId}-{legIndex}`
 *
 * `transactionStateId` có thể là `null` ở bước cuối của withdraw, khi amount
 * được đẩy từ CUSTODY_ASSET_ACCOUNT(CONFIRMING) sang EXTERNAL_ACCOUNT(null).
 * Với các bucket "null-state" này, không được ép về state cũ (`fromStateId`)
 * vì sẽ làm token trùng với việc chuyển từ state cũ trước đó và gây duplicate
 * / false-positive idempotency. Vì thế trong token ta chuẩn hoá `null` thành 0
 * để duy trì tính deterministic và phân biệt rõ với các state thực.
 */
export function buildPostingIdempotencyToken(params: {
  idempotencyToken: string;
  transactionTypeId: number;
  transactionStateId: number | null;
  bookPostingPurposeId: number;
  legIndex: number;
}): string {
  const stateToken = params.transactionStateId ?? 0;
  return `${params.idempotencyToken}-${params.transactionTypeId}-${stateToken}-${params.bookPostingPurposeId}-${params.legIndex}`;
}
