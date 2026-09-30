import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';
import type { BookPurposeDefinition } from '../constants';
import type { BookParams, LegItem } from '../types';

function baseBookParams(item: LegItem, purpose: BookPurposeDefinition, transactionStateId: number | null, createdBy?: number): BookParams {
  return {
    name: purpose.code,
    clientId: item.clientId,
    accountId: item.accountId,
    assetId: item.assetId,
    assetTypeId: item.assetTypeId,
    assetTicker: item.assetTicker,
    walletTypeId: item.walletTypeId,
    bookPurposeId: purpose.id,
    transactionStateId,
    createdBy,
  };
}

export function custodyBookParams(item: LegItem, transactionStateId: number | null, createdBy?: number): BookParams {
  return baseBookParams(item, BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT, transactionStateId, createdBy);
}

export function externalBookParams(item: LegItem, createdBy?: number): BookParams {
  return baseBookParams(item, BOOK_PURPOSE.BLOCKCHAIN_EXTERNAL_ACCOUNT, TRANSACTION_STATE.NOT_APPLICABLE.id, createdBy);
}
