import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';
import type { BookLegParams, LegItem } from '../interfaces';

function baseBookParams(
  item: LegItem,
  bookPurposeCode: string,
  bookPurposeId: number,
  transactionStateId: number | null,
  createdBy?: number,
): BookLegParams {
  return {
    name: bookPurposeCode,
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

export function custodyBookParams(item: LegItem, transactionStateId: number | null, createdBy?: number): BookLegParams {
  return baseBookParams(item, BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code, BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id, transactionStateId, createdBy);
}

export function externalBookParams(item: LegItem, createdBy?: number): BookLegParams {
  return baseBookParams(
    item,
    BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.code,
    BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.id,
    TRANSACTION_STATE.NOT_APPLICABLE.id,
    createdBy,
  );
}
