export interface TransactionCommandBase {
  idempotencyToken: string;
  uuidToken: string;
}
