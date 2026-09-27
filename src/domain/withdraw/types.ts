import { AssetBookDescriptor, BaseTransactionRequest } from '../shared/types';

export type WithdrawKind = 'EXTERNAL' | 'INTERNAL';

export type WithdrawTargetState = 'AUTHORIZED' | 'SENT' | 'CONFIRMING' | 'CONFIRMED';

export interface WithdrawRequest extends BaseTransactionRequest {
  fee: string;
  /**
   * source / destination account phải được mô tả rõ ràng để biết đây là
   * withdrawal nội bộ hay ngoại bộ. `accountId` vẫn giữ làm alias tương thích,
   * nhưng trong code mới nên ưu tiên `fromAccountId`/`toAccountId`.
   */
  fromAccountId?: number | null;
  toAccountId?: number | null;
  /**
   * Mô tả rõ asset chịu phí. Ví dụ: chuyển 100 USDT nhưng phí gas trả bằng ETH.
   * Nếu không truyền, feeAsset sẽ mặc định bằng amountAsset, phù hợp case phổ biến.
   */
  feeAsset?: AssetBookDescriptor;
  feeAssetId?: number;
  feeAssetTypeId?: number;
  feeAssetTicker?: string;
  /**
   * EXTERNAL (mặc định): rút ra ngoài hệ thống qua blockchain thật — đi đủ
   *   AUTHORIZING -> AUTHORIZED -> SENT -> CONFIRMING -> CONFIRMED.
   * INTERNAL: chuyển nội bộ / không có tx blockchain thật — KHÔNG có
   *   SENT/CONFIRMING, chỉ: AUTHORIZING -> AUTHORIZED -> CONFIRMED.
   */
  kind?: WithdrawKind;
}
