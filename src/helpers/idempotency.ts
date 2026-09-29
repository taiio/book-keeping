export function bookPostingIdempotencyToken(
  journalIdempotencyToken: string,
  transactionTypeId: number,
  transactionStateId: number,
  index: number,
): string {
  return `${journalIdempotencyToken}-${transactionTypeId}-${transactionStateId}-${index}`;
}
