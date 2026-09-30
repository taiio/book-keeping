/** The ids that identify an internal account/wallet for a given asset. */
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

/** Account identity where only the asset is guaranteed (external/unknown accounts). */
export type PartialAccountIdentity = Partial<Omit<AccountIdentity, 'assetId'>> & Pick<AccountIdentity, 'assetId'>;

export interface AccountItem extends PartialAccountIdentity, AssetAmount {
  idempotencyToken: string;

  poolId?: string;
  address?: string;
}

export interface FeeItem extends AccountIdentity, AssetAmount {
  idempotencyToken: string;
}

/**
 * Minimal identity + asset shape needed to resolve a Book. Both AccountItem and FeeItem satisfy it.
 */
export type LegItem = Pick<AccountItem, 'clientId' | 'accountId' | 'assetTypeId' | 'walletTypeId' | 'assetId' | 'assetTicker'>;
