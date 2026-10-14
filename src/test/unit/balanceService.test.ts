import * as assert from 'node:assert/strict';

import { ValidationError } from '../../common/errors';
import { BalanceQueryService } from '../../queries/BalanceQueryService';
import type { AssetBalance, BalanceQuery } from '../../types';

const entry = (assetTypeId: number): AssetBalance => ({ assetId: assetTypeId, assetTypeId, walletTypeId: 1, assetTicker: 'ETH', balance: '5', availableBalance: '7' });

function setup(result: AssetBalance[] = []) {
  const queries: BalanceQuery[] = [];
  const repository = {
    findBalances: async (query: BalanceQuery) => {
      queries.push(query);

      return result;
    },
  };

  return { service: new BalanceQueryService(repository as never), queries };
}

describe('BalanceQueryService', () => {
  it('GetBalances asks the repository for every asset of the account', async () => {
    const { service, queries } = setup([entry(2)]);

    const response = await service.getBalances({ clientId: 4, accountId: 9 });

    assert.deepEqual(queries, [{ clientId: 4, accountId: 9, assets: null }]);
    assert.deepEqual(response, { clientId: 4, accountId: 9, balances: [entry(2)] });
  });

  it('GetBalance asks only for the requested assets and echoes the client and the account', async () => {
    const { service, queries } = setup([entry(2), entry(3)]);

    const response = await service.getBalance({ clientId: 4, accountId: 9, assets: [{ assetTypeId: 2, walletTypeId: 1 }, { assetTypeId: 3, walletTypeId: 1 }] });

    assert.deepEqual(queries[0].assets, [{ assetTypeId: 2, walletTypeId: 1 }, { assetTypeId: 3, walletTypeId: 1 }]);
    assert.equal(response.clientId, 4);
    assert.equal(response.accountId, 9);
    assert.equal(response.balances.length, 2);
  });

  it('answers an account with no books with an empty list, not an error', async () => {
    const { service } = setup([]);

    assert.deepEqual(await service.getBalances({ clientId: 1, accountId: 2 }), { clientId: 1, accountId: 2, balances: [] });
  });

  it('refuses an invalid request without reading anything', async () => {
    const { service, queries } = setup();

    await assert.rejects(() => service.getBalances({ clientId: 0, accountId: 2 }), ValidationError);
    await assert.rejects(() => service.getBalance({ clientId: 1, accountId: 2, assets: [] }), ValidationError);
    await assert.rejects(() => service.getBalance({ clientId: 1, accountId: 2 }), ValidationError);

    assert.equal(queries.length, 0);
  });
});
