import type { AccountIdentity, AccountItem, InternalAccountItem, LegItem } from '../types';

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
