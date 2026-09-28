import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';
import type { BookLegParams, LegItem } from '../interfaces';

function baseBookParams(item: LegItem, suffix: string, bookPurposeId: number, transactionStateId: number | null, createdBy?: number): BookLegParams {
  return {
    name: `${item.assetTicker} ${suffix}`,
    clientId: item.clientId ?? 0,
    accountId: item.accountId ?? 0,
    assetId: item.assetId,
    assetTypeId: item.assetTypeId ?? 0,
    assetTicker: item.assetTicker,
    walletTypeId: item.walletTypeId ?? 0,
    bookPurposeId,
    transactionStateId,
    createdBy,
  };
}

/** Book của một item ở bucket CUSTODY_ASSET_ACCOUNT tại 1 transactionStateId cụ thể. */
export function custodyBookParams(item: LegItem, transactionStateId: number | null, createdBy?: number): BookLegParams {
  return baseBookParams(item, 'custody', BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id, transactionStateId, createdBy);
}

/** Book của một item ở BLOCKCHIAN_EXTERNAL_ACCOUNT (luôn NOT_APPLICABLE — book này không có state chi tiết). */
export function externalBookParams(item: LegItem, createdBy?: number): BookLegParams {
  return baseBookParams(item, 'blockchain external', BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.id, TRANSACTION_STATE.NOT_APPLICABLE.id, createdBy);
}
