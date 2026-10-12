export interface AssetRef {
  assetTypeId: number;
  walletTypeId: number;
}

export interface GetBalanceQuery {
  clientId: number;
  accountId: number;
  assets: AssetRef[];
}

export interface GetBalancesQuery {
  clientId: number;
  accountId: number;
}

export interface FindCustodyBooksParams {
  clientId: number;
  accountId: number;
  assets?: AssetRef[];
}

export interface AssetBalanceView {
  assetId: number;
  assetTypeId: number;
  walletTypeId: number;
  assetTicker: string;

  balance: string;
  availableBalance: string;
}

export interface AccountBalanceView {
  clientId: number;
  accountId: number;
  balances: AssetBalanceView[];
}
