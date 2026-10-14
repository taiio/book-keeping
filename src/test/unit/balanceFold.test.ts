import * as assert from 'node:assert/strict';

import { TRANSACTION_STATE } from '../../constants';
import { foldBalances } from '../../helpers';
import type { BalanceBook } from '../../types';

const S = TRANSACTION_STATE;

const book = (overrides: Partial<BalanceBook> & Pick<BalanceBook, 'transactionStateId' | 'amount'>): BalanceBook => ({
  assetId: 2,
  assetTypeId: 2,
  assetTicker: 'ETH',
  walletTypeId: 1,
  ...overrides,
});

describe('foldBalances', () => {
  it('reports the confirmed book as the balance and the sum of every book as the available balance', () => {
    const [entry] = foldBalances([
      book({ transactionStateId: S.AUTHORIZING.id, amount: '10' }),
      book({ transactionStateId: S.AUTHORIZED.id, amount: '20' }),
      book({ transactionStateId: S.SENT.id, amount: '30' }),
      book({ transactionStateId: S.CONFIRMING.id, amount: '40' }),
      book({ transactionStateId: S.CONFIRMED.id, amount: '500' }),
    ]);

    assert.equal(entry.balance, '500');
    assert.equal(entry.availableBalance, '600');
  });

  it('reports a balance of zero when there is no confirmed book, but still counts the other books', () => {
    const [entry] = foldBalances([book({ transactionStateId: S.AUTHORIZING.id, amount: '10' }), book({ transactionStateId: S.CONFIRMING.id, amount: '5' })]);

    assert.equal(entry.balance, '0');
    assert.equal(entry.availableBalance, '15');
  });

  it('keeps the identity of the asset', () => {
    const [entry] = foldBalances([book({ transactionStateId: S.CONFIRMED.id, amount: '1', assetId: 6, assetTypeId: 3, assetTicker: 'USDT', walletTypeId: 2 })]);

    assert.deepEqual([entry.assetId, entry.assetTypeId, entry.assetTicker, entry.walletTypeId], [6, 3, 'USDT', 2]);
  });

  it('makes one entry per asset and wallet type, in the order the books arrive', () => {
    const entries = foldBalances([
      book({ transactionStateId: S.CONFIRMED.id, amount: '1' }),
      book({ transactionStateId: S.SENT.id, amount: '2' }),
      book({ walletTypeId: 2, transactionStateId: S.CONFIRMED.id, amount: '3' }),
      book({ assetTypeId: 3, assetId: 3, assetTicker: 'USDT', transactionStateId: S.CONFIRMED.id, amount: '4' }),
    ]);

    assert.deepEqual(
      entries.map((entry) => [entry.assetTypeId, entry.walletTypeId, entry.balance, entry.availableBalance]),
      [
        [2, 1, '1', '3'],
        [2, 2, '3', '3'],
        [3, 1, '4', '4'],
      ],
    );
  });

  it('ignores a book that has no stage', () => {
    assert.deepEqual(foldBalances([book({ transactionStateId: null, amount: '9' })]), []);
  });

  it('adds up books of the same stage instead of dropping one (the database allows only one, so this is a safeguard)', () => {
    const [entry] = foldBalances([book({ transactionStateId: S.CONFIRMED.id, amount: '40' }), book({ transactionStateId: S.CONFIRMED.id, amount: '2' })]);

    assert.equal(entry.balance, '42');
    assert.equal(entry.availableBalance, '42');
  });

  it('keeps full precision for amounts beyond what a JavaScript number can hold', () => {
    const [entry] = foldBalances([
      book({ transactionStateId: S.CONFIRMED.id, amount: '123456789012345678901234567890' }),
      book({ transactionStateId: S.SENT.id, amount: '9007199254740993' }),
    ]);

    assert.equal(entry.balance, '123456789012345678901234567890');
    assert.equal(entry.availableBalance, '123456789012354686100489308883');
  });

  it('handles a negative amount', () => {
    const [entry] = foldBalances([book({ transactionStateId: S.CONFIRMED.id, amount: '-5' }), book({ transactionStateId: S.SENT.id, amount: '8' })]);

    assert.equal(entry.balance, '-5');
    assert.equal(entry.availableBalance, '3');
  });

  it('returns nothing for no books', () => {
    assert.deepEqual(foldBalances([]), []);
  });
});
