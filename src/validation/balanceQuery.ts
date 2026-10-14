import { ValidationError } from '../common/errors';
import { BALANCE_QUERY } from '../constants';
import type { AssetRef, BalanceQuery, GetBalanceRequest, GetBalancesRequest } from '../types';

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= BALANCE_QUERY.MAX_ID;

function parseAccount(request: GetBalancesRequest): Pick<BalanceQuery, 'clientId' | 'accountId'> {
  if (!isId(request?.clientId)) throw new ValidationError('clientId is required and must be a positive 32-bit integer');

  if (!isId(request.accountId)) throw new ValidationError('accountId is required and must be a positive 32-bit integer');

  return { clientId: request.clientId, accountId: request.accountId };
}

function parseAssets(assets: readonly AssetRef[] | undefined): AssetRef[] {
  const list = assets ?? [];

  if (list.length === 0) throw new ValidationError('assets must contain at least one asset');

  if (list.length > BALANCE_QUERY.MAX_ASSETS) throw new ValidationError(`assets accepts at most ${BALANCE_QUERY.MAX_ASSETS} assets`);

  const distinct = new Map<string, AssetRef>();

  for (const asset of list) {
    if (!isId(asset?.assetTypeId) || !isId(asset.walletTypeId)) throw new ValidationError('every asset needs a positive 32-bit assetTypeId and walletTypeId');

    distinct.set(`${asset.assetTypeId}:${asset.walletTypeId}`, { assetTypeId: asset.assetTypeId, walletTypeId: asset.walletTypeId });
  }

  return [...distinct.values()];
}

export function parseGetBalances(request: GetBalancesRequest): BalanceQuery {
  return { ...parseAccount(request), assets: null };
}

export function parseGetBalance(request: GetBalanceRequest): BalanceQuery {
  return { ...parseAccount(request), assets: parseAssets(request.assets) };
}
