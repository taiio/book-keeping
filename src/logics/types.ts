/**
 * Field dùng chung cho mọi nghiệp vụ (deposit / withdraw / stake / ...).
 * Mỗi nghiệp vụ chỉ cần extend thêm field riêng (vd WithdrawRequest có `fee`).
 */
export interface BaseTransactionRequest {
  idempotencyToken: string;
  uuidToken: string;
  clientId: number;
  accountId: number;
  assetId: number;
  assetTypeId: number;
  assetTicker: string;
  walletTypeId: number;
  address?: string | null;
  amount: string;
  transactionHash?: string;
  createdBy?: number | null;
  businessPostDateTime: Date;
}
