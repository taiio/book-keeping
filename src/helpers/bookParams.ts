import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';
import type { BookPurposeDefinition } from '../constants';
import type { BookParams, BookRef, LegItem } from '../types';
import { isExternalBook } from './bookRef';

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

/** Params of the book a `BookRef` selects for an account/asset. */
export function bookParamsForRef(item: LegItem, ref: BookRef, createdBy?: number): BookParams {
  return isExternalBook(ref) ? externalBookParams(item, createdBy) : custodyBookParams(item, ref.transactionStateId, createdBy);
}

/** Stable string identity of a book (the fields of its unique key), for in-memory caches. */
export function bookKeyString(params: BookParams): string {
  return [params.clientId, params.accountId, params.assetTypeId, params.walletTypeId, params.bookPurposeId, params.transactionStateId ?? 'none'].join('|');
}
