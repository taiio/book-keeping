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

/** Design "Withdraw" (FEE): Fee Confirming Book — trung gian giữa bucket Confirming và Fee Revenue. */
export function feeConfirmingBookParams(item: LegItem, createdBy?: number): BookLegParams {
  return baseBookParams(item, 'fee confirming', BOOK_PURPOSE.FEE_CONFIRMING_ACCOUNT.id, TRANSACTION_STATE.CONFIRMING.id, createdBy);
}

/** Design "Withdraw" (FEE): Fee Revenue Book — của platform nên không gắn client/account/wallet nào (gộp theo asset). */
export function feeRevenueBookParams(item: LegItem, createdBy?: number): BookLegParams {
  return {
    ...baseBookParams(item, 'fee revenue', BOOK_PURPOSE.FEE_REVENUE_ACCOUNT.id, TRANSACTION_STATE.CONFIRMED.id, createdBy),
    clientId: 0,
    accountId: 0,
    walletTypeId: 0,
  };
}
