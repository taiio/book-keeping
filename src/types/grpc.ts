import type { ServiceDefinition } from '@grpc/grpc-js';

import type { env } from '../config/env';
import type { AssetRef } from './balance';

export type GrpcSettings = typeof env.grpc;

export interface AssetBalance {
  assetId: number;
  assetTypeId: number;
  walletTypeId: number;
  assetTicker: string;
  balance: string;
  availableBalance: string;
}

export interface GetBalanceRequest {
  clientId: number;
  accountId: number;
  assets?: AssetRef[];
}

export interface GetBalancesRequest {
  clientId: number;
  accountId: number;
}

export interface GetBalanceResponse {
  clientId: number;
  accountId: number;
  balances: AssetBalance[];
}

export interface GrpcError {
  code: number;
  details: string;
}

export interface BalanceProto {
  bookkeeping: { v1: { BalanceService: { service: ServiceDefinition } } };
}
