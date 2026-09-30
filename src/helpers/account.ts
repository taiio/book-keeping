import type { AccountIdentity, AccountItem, LegItem } from '../types';

export function isInternalRecipient(item: AccountItem): boolean {
  return item.clientId !== undefined && item.accountId !== undefined && item.assetTypeId !== undefined && item.walletTypeId !== undefined;
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
