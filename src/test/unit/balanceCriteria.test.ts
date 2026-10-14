import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';

import { BOOK_PURPOSE } from '../../constants';
import { BALANCE_ATTRIBUTES, BALANCE_ORDER, buildBalanceCriteria } from '../../repositories/balanceCriteria';
import type { BalanceQuery } from '../../types';

const query = (overrides: Partial<BalanceQuery> = {}): BalanceQuery => ({ clientId: 3, accountId: 7, assets: null, ...overrides });

const whereOf = (balanceQuery: BalanceQuery) => buildBalanceCriteria(balanceQuery).where as Record<string | symbol, unknown>;

describe('buildBalanceCriteria', () => {
  it('reads the custody books of one account that have a stage, and nothing else', () => {
    assert.deepEqual(whereOf(query()), {
      clientId: 3,
      accountId: 7,
      bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
      transactionStateId: { [Op.not]: null },
    });
  });

  it('puts no condition on the asset when every asset is asked for', () => {
    assert.equal(whereOf(query())[Op.or], undefined);
  });

  it('allows any of the requested asset and wallet type pairs', () => {
    const where = whereOf(query({ assets: [{ assetTypeId: 2, walletTypeId: 1 }, { assetTypeId: 3, walletTypeId: 2 }] }));

    assert.deepEqual(where[Op.or], [
      { assetTypeId: 2, walletTypeId: 1 },
      { assetTypeId: 3, walletTypeId: 2 },
    ]);
  });

  it('pairs asset type with wallet type instead of filtering them independently', () => {
    const where = whereOf(query({ assets: [{ assetTypeId: 2, walletTypeId: 1 }, { assetTypeId: 3, walletTypeId: 2 }] }));

    assert.equal(where.assetTypeId, undefined);
    assert.equal(where.walletTypeId, undefined);
  });

  it('selects only the columns the balances need', () => {
    assert.deepEqual(buildBalanceCriteria(query()).attributes, BALANCE_ATTRIBUTES);
    assert.ok(!BALANCE_ATTRIBUTES.includes('createdBy'));
  });

  it('sorts so that the answer is stable', () => {
    assert.deepEqual(buildBalanceCriteria(query()).order, BALANCE_ORDER);
    assert.deepEqual(
      (BALANCE_ORDER as string[][]).map(([column]) => column),
      ['assetTypeId', 'walletTypeId', 'assetId', 'assetTicker'],
    );
  });

  it('keeps every caller supplied value as data in the criteria', () => {
    const where = whereOf(query({ clientId: 99, accountId: 5 }));

    assert.equal(where.clientId, 99);
    assert.equal(where.accountId, 5);
  });
});
