/**
 * Định nghĩa "book key" chính xác cho 1 tài sản trong 1 account/wallet.
 *
 * Unique index của Book là:
 *   (client_id, account_id, asset_type_id, wallet_type_id, book_purpose_id, transaction_state_id)
 *
 * Về mặt nghiệp vụ, request nên phân biệt rõ:
 * - `amountAsset`: tài sản đang bị chuyển / rút / stake
 * - `feeAsset`: phí gas / phí xử lý, có thể khác asset với amountAsset
 */
export interface AssetBookDescriptor {
  clientId: number;
  accountId: number;
  assetId: number;
  assetTypeId: number;
  assetTicker: string;
  walletTypeId: number;
  address?: string | null;
}

/**
 * Base request dùng chung nhưng cho phép mô hình hóa 2 asset độc lập:
 * - `amountAsset`: asset chính của nghiệp vụ
 * - `feeAsset`: asset phí, tùy chọn
 *
 * Các field flat giữ lại để tương thích ngược với code cũ, nhưng code mới
 * nên ưu tiên đọc từ `amountAsset` / `feeAsset`.
 */
export interface BaseTransactionRequest {
  idempotencyToken: string;
  uuidToken: string;
  amount: string;
  transactionHash?: string;
  createdBy?: number | null;
  businessPostDateTime: Date;

  amountAsset?: AssetBookDescriptor;
  feeAsset?: AssetBookDescriptor;

  /**
   * Backward-compatibility: dùng làm alias cho `amountAsset`.
   */
  book?: AssetBookDescriptor;
  clientId: number;
  accountId: number;
  assetId: number;
  assetTypeId: number;
  assetTicker: string;
  walletTypeId: number;
  address?: string | null;
}

export function resolveAmountAsset(request: BaseTransactionRequest): AssetBookDescriptor {
  return (
    request.amountAsset ??
    request.book ?? {
      clientId: request.clientId,
      accountId: request.accountId,
      assetId: request.assetId,
      assetTypeId: request.assetTypeId,
      assetTicker: request.assetTicker,
      walletTypeId: request.walletTypeId,
      address: request.address ?? null,
    }
  );
}

export function resolveFeeAsset(request: BaseTransactionRequest): AssetBookDescriptor {
  return request.feeAsset ?? resolveAmountAsset(request);
}
