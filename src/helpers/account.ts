import type { AccountIdentity, AccountItem, FeePayerRef, InternalAccountItem, LegItem } from '../types';
import type { Book } from '../models';

export function isInternalItem(item: AccountItem): item is InternalAccountItem {
  return item.account !== undefined;
}

export function isFeePaidBy(fee: FeePayerRef, party: FeePayerRef): boolean {
  return (
    !!fee.idempotencyToken &&
    fee.idempotencyToken === party.idempotencyToken &&
    fee.account?.accountId !== undefined &&
    fee.account.accountId === party.account?.accountId
  );
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

export function sameLegItem(a: LegItem, b: LegItem): boolean {
  return a.clientId === b.clientId && a.accountId === b.accountId && a.assetTypeId === b.assetTypeId && a.walletTypeId === b.walletTypeId;
}
