export interface FeeItem {
  clientId?: number;
  accountId?: number;

  assetTypeId?: number;
  walletTypeId?: number;

  assetId: number;
  quantity: string;
}
