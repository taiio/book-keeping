import { Op } from 'sequelize';
import type { FindOptions, Order, WhereOptions } from 'sequelize';

import { BOOK_PURPOSE, SORT_DIRECTION } from '../constants';
import type { BalanceQuery } from '../types';

export const BALANCE_ATTRIBUTES = ['assetId', 'assetTypeId', 'assetTicker', 'walletTypeId', 'transactionStateId', 'amount'];

export const BALANCE_ORDER: Order = [
  ['assetTypeId', SORT_DIRECTION.ASC],
  ['walletTypeId', SORT_DIRECTION.ASC],
  ['assetId', SORT_DIRECTION.ASC],
  ['assetTicker', SORT_DIRECTION.ASC],
];

export function buildBalanceCriteria(query: BalanceQuery): FindOptions {
  const { clientId, accountId, assets } = query;

  const where: Record<string | symbol, unknown> = {
    clientId,
    accountId,
    bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
    transactionStateId: { [Op.not]: null },
  };

  if (assets) where[Op.or] = assets.map(({ assetTypeId, walletTypeId }) => ({ assetTypeId, walletTypeId }));

  return { attributes: BALANCE_ATTRIBUTES, where: where as WhereOptions, order: BALANCE_ORDER };
}
