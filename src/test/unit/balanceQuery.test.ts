import * as assert from 'node:assert/strict';

import { ValidationError } from '../../common/errors';
import { BALANCE_QUERY } from '../../constants';
import { parseGetBalance, parseGetBalances } from '../../validation';

const BAD_IDS: unknown[] = [0, -1, 1.5, 2 ** 31, Number.NaN, '3', null];

describe('parseGetBalances', () => {
  it('needs a client and an account, and asks for every asset', () => {
    assert.deepEqual(parseGetBalances({ clientId: 1, accountId: 2 }), { clientId: 1, accountId: 2, assets: null });
  });

  it('rejects a missing or malformed client or account', () => {
    for (const bad of BAD_IDS) {
      assert.throws(() => parseGetBalances({ clientId: bad as number, accountId: 2 }), ValidationError, `clientId ${String(bad)}`);
      assert.throws(() => parseGetBalances({ clientId: 1, accountId: bad as number }), ValidationError, `accountId ${String(bad)}`);
    }

    assert.throws(() => parseGetBalances(undefined as never), ValidationError);
    assert.throws(() => parseGetBalances({} as never), ValidationError);
  });
});

describe('parseGetBalance', () => {
  const asset = (assetTypeId: number, walletTypeId: number) => ({ assetTypeId, walletTypeId });

  it('keeps the requested assets in the order given', () => {
    assert.deepEqual(parseGetBalance({ clientId: 1, accountId: 2, assets: [asset(3, 1), asset(2, 1), asset(2, 2)] }), {
      clientId: 1,
      accountId: 2,
      assets: [asset(3, 1), asset(2, 1), asset(2, 2)],
    });
  });

  it('asks for each asset once, however many times it was listed', () => {
    const query = parseGetBalance({ clientId: 1, accountId: 2, assets: [asset(2, 1), asset(3, 1), asset(2, 1), asset(2, 1)] });

    assert.deepEqual(query.assets, [asset(2, 1), asset(3, 1)]);
  });

  it('needs at least one asset', () => {
    assert.throws(() => parseGetBalance({ clientId: 1, accountId: 2, assets: [] }), ValidationError);
    assert.throws(() => parseGetBalance({ clientId: 1, accountId: 2 }), ValidationError);
  });

  it('accepts exactly the maximum number of assets and rejects one more', () => {
    const assets = (count: number) => Array.from({ length: count }, (_, index) => asset(index + 1, 1));

    assert.equal(parseGetBalance({ clientId: 1, accountId: 2, assets: assets(BALANCE_QUERY.MAX_ASSETS) }).assets?.length, BALANCE_QUERY.MAX_ASSETS);
    assert.throws(() => parseGetBalance({ clientId: 1, accountId: 2, assets: assets(BALANCE_QUERY.MAX_ASSETS + 1) }), ValidationError);
  });

  it('counts the assets that were sent, not the distinct ones, against the maximum', () => {
    const repeated = Array.from({ length: BALANCE_QUERY.MAX_ASSETS + 1 }, () => asset(2, 1));

    assert.throws(() => parseGetBalance({ clientId: 1, accountId: 2, assets: repeated }), ValidationError);
  });

  it('rejects an asset whose ids are not positive 32-bit integers', () => {
    for (const bad of BAD_IDS) {
      assert.throws(() => parseGetBalance({ clientId: 1, accountId: 2, assets: [asset(bad as number, 1)] }), ValidationError, `assetTypeId ${String(bad)}`);
      assert.throws(() => parseGetBalance({ clientId: 1, accountId: 2, assets: [asset(2, bad as number)] }), ValidationError, `walletTypeId ${String(bad)}`);
    }

    assert.throws(() => parseGetBalance({ clientId: 1, accountId: 2, assets: [null as never] }), ValidationError);
  });

  it('checks the client and the account like GetBalances does', () => {
    for (const bad of BAD_IDS) {
      assert.throws(() => parseGetBalance({ clientId: bad as number, accountId: 2, assets: [asset(2, 1)] }), ValidationError);
      assert.throws(() => parseGetBalance({ clientId: 1, accountId: bad as number, assets: [asset(2, 1)] }), ValidationError);
    }
  });
});
