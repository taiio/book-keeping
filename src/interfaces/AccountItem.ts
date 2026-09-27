export interface AccountItem {
  clientId?: number;
  accountId?: number;

  assetTypeId?: number;
  walletTypeId?: number;

  assetId: number;
  quantity: string;

  poolId?: string;
  address?: string;
}
