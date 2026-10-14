export interface AssetRef {
  assetTypeId: number;
  walletTypeId: number;
}

export interface BalanceQuery {
  clientId: number;
  accountId: number;
  assets: AssetRef[] | null;
}

export interface BalanceBook {
  assetId: number;
  assetTypeId: number;
  assetTicker: string;
  walletTypeId: number;
  transactionStateId: number | null;
  amount: string;
}
