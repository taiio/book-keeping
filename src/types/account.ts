export interface AccountIdentity {
  clientId: number;
  accountId: number;

  assetId: number;
  assetTypeId: number;
  walletTypeId: number;
}

export interface AssetAmount {
  assetTicker: string;
  quantity: string;
}

export type AccountAssetIdentity = AccountIdentity & Pick<AssetAmount, 'assetTicker'>;

export interface AccountItem extends AssetAmount {
  idempotencyToken: string;
  address?: string;
  poolId?: string;

  account?: AccountIdentity;
}

export type InternalAccountItem = AccountItem & { account: AccountIdentity };

export interface FeePayerRef {
  idempotencyToken?: string | null;
  account?: Pick<AccountIdentity, 'accountId'>;
}

export interface FeeItem extends AssetAmount {
  idempotencyToken: string;

  account: AccountIdentity;
}

export type LegItem = AccountAssetIdentity;

export interface QuantityItem {
  assetTicker: string;
  quantity: string;
}
