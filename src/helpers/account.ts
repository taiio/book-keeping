import type { AccountIdentity, AccountItem, InternalAccountItem, LegItem } from '../types';
import type { Book } from '../models';

export function isInternalItem(item: AccountItem): item is InternalAccountItem {
  return item.account !== undefined;
}

export function toLegItem(account: AccountIdentity, assetTicker: string): LegItem {
  return {
    clientId: account.clientId,
    accountId: account.accountId,
    assetTypeId: account.assetTypeId,
    walletTypeId: account.walletTypeId,
    assetId: account.assetId,
    assetTicker,
  };
}

/** Rebuilds the account/asset identity of a persisted book. */
export function legItemFromBook(book: Book): LegItem {
  return {
    clientId: book.clientId,
    accountId: book.accountId,
    assetTypeId: book.assetTypeId,
    walletTypeId: book.walletTypeId,
    assetId: book.assetId,
    assetTicker: book.assetTicker,
  };
}

/** Two items address the same book family when they share the fields of the book unique key. */
export function sameLegItem(a: LegItem, b: LegItem): boolean {
  return a.clientId === b.clientId && a.accountId === b.accountId && a.assetTypeId === b.assetTypeId && a.walletTypeId === b.walletTypeId;
}
