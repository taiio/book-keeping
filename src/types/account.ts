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

/**
 * One party (sender or recipient) of a system transaction.
 * `account` is present only for internal custody accounts; an external party (e.g. a withdraw to an outside wallet)
 * is identified by `address` alone. Same shape as the parties of `BlockchainMessagePayload`.
 */
export interface AccountItem extends AssetAmount {
  idempotencyToken: string;
  address?: string;
  poolId?: string;

  account?: AccountIdentity;
}

/** An `AccountItem` known to be internal (narrowed by `isInternalItem`). */
export type InternalAccountItem = AccountItem & { account: AccountIdentity };

/** The network fee of a system transaction: always paid by an internal account. */
export interface FeeItem extends AssetAmount {
  idempotencyToken: string;

  account: AccountIdentity;
}

/** Identity + asset shape needed to resolve a Book (built with `toLegItem`). */
export type LegItem = AccountAssetIdentity;
