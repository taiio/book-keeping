import * as assert from 'node:assert/strict';
import { Op } from 'sequelize';

import { BOOK_PURPOSE, TRANSACTION_STATE } from '../../constants';
import { BalanceQueryService } from '../../queries/BalanceQueryService';
import { buildBalanceCriteria } from '../../repositories/balanceCriteria';
import { foldBalances } from '../../helpers';
import type { AssetBalance, AssetRef, BalanceBook, BalanceQuery } from '../../types';

interface StoredBook extends BalanceBook {
  clientId: number;
  accountId: number;
  bookPurposeId: number;
}

const S = TRANSACTION_STATE;
const STATES = [S.AUTHORIZING.id, S.AUTHORIZED.id, S.SENT.id, S.CONFIRMING.id, S.CONFIRMED.id];
const TICKERS = ['ETH', 'USDT', 'BTC'];
const CUSTODY = BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id;
const EXTERNAL = BOOK_PURPOSE.BLOCKCHAIN_EXTERNAL_ACCOUNT.id;

function seeded(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;

    return state / 2_147_483_648;
  };
}

const random = seeded(7);

function buildBooks(): StoredBook[] {
  const books: StoredBook[] = [];

  for (const clientId of [1, 2]) {
    for (let accountId = 1; accountId <= 8; accountId++) {
      for (let assetTypeId = 1; assetTypeId <= 3; assetTypeId++) {
        for (const walletTypeId of [1, 2]) {
          if (random() < 0.3) continue;

          const base = { clientId, accountId, assetTypeId, walletTypeId, assetId: assetTypeId * 10, assetTicker: TICKERS[assetTypeId - 1] };
          const states = STATES.filter(() => random() < 0.6);

          for (const transactionStateId of states.length > 0 ? states : [S.CONFIRMED.id]) {
            books.push({ ...base, bookPurposeId: CUSTODY, transactionStateId, amount: String(Math.floor(random() * 1000) - 100) });
          }

          books.push({ ...base, bookPurposeId: EXTERNAL, transactionStateId: null, amount: '-999' });
          books.push({ ...base, bookPurposeId: CUSTODY, transactionStateId: null, amount: '777' });
        }
      }
    }
  }

  return books;
}

function matches(book: Record<string, unknown>, where: Record<string | symbol, unknown>): boolean {
  return Reflect.ownKeys(where).every((key) => {
    const expected = where[key];

    if (key === Op.or) return (expected as Array<Record<string | symbol, unknown>>).some((branch) => matches(book, branch));

    const actual = book[key as string];

    if (typeof expected === 'object' && expected !== null && Op.not in expected) return actual !== (expected as Record<symbol, unknown>)[Op.not];

    return actual === expected;
  });
}

function runCriteria(books: StoredBook[], query: BalanceQuery): BalanceBook[] {
  const criteria = buildBalanceCriteria(query);
  const order = criteria.order as string[][];

  return books
    .filter((book) => matches(book as unknown as Record<string, unknown>, criteria.where as Record<string | symbol, unknown>))
    .sort((a, b) => {
      for (const [column] of order) {
        const left = (a as unknown as Record<string, string | number>)[column];
        const right = (b as unknown as Record<string, string | number>)[column];

        if (left !== right) return left < right ? -1 : 1;
      }

      return 0;
    });
}

function expectedBalances(books: StoredBook[], clientId: number, accountId: number, refs?: AssetRef[]): AssetBalance[] {
  const groups = new Map<string, AssetBalance & { confirmed: bigint; all: bigint }>();

  for (const book of books) {
    const wanted = !refs || refs.some((ref) => ref.assetTypeId === book.assetTypeId && ref.walletTypeId === book.walletTypeId);

    if (book.clientId !== clientId || book.accountId !== accountId || book.bookPurposeId !== CUSTODY || book.transactionStateId === null || !wanted) continue;

    const key = `${book.assetTypeId}/${book.walletTypeId}`;
    const group = groups.get(key) ?? { assetId: book.assetId, assetTypeId: book.assetTypeId, walletTypeId: book.walletTypeId, assetTicker: book.assetTicker, balance: '', availableBalance: '', confirmed: 0n, all: 0n };

    group.all += BigInt(book.amount);

    if (book.transactionStateId === S.CONFIRMED.id) group.confirmed += BigInt(book.amount);

    groups.set(key, group);
  }

  return [...groups.values()]
    .sort((a, b) => a.assetTypeId - b.assetTypeId || a.walletTypeId - b.walletTypeId)
    .map(({ confirmed, all, ...entry }) => ({ ...entry, balance: confirmed.toString(), availableBalance: all.toString() }));
}

const books = buildBooks();
const service = new BalanceQueryService({ findBalances: async (query: BalanceQuery) => foldBalances(runCriteria(books, query)) } as never);

describe('balances over a generated ledger', () => {
  it('GetBalances matches an independent computation for every account', async () => {
    let compared = 0;

    for (let accountId = 1; accountId <= 8; accountId++) {
      const response = await service.getBalances({ clientId: 1, accountId });

      assert.deepEqual(response.balances, expectedBalances(books, 1, accountId), `account ${accountId}`);
      compared += response.balances.length;
    }

    assert.ok(compared > 20);
  });

  it('never reports another client, the external book, or a book without a stage', async () => {
    for (let accountId = 1; accountId <= 8; accountId++) {
      const { balances } = await service.getBalances({ clientId: 1, accountId });

      const text = JSON.stringify(balances);

      assert.ok(!balances.some((entry) => entry.availableBalance === '777' || entry.balance === '777'));
      assert.ok(!text.includes('-999'));
    }
  });

  it('GetBalance matches an independent computation for random sets of assets, including ones with no book', async () => {
    const all: AssetRef[] = [];

    for (let assetTypeId = 1; assetTypeId <= 4; assetTypeId++) for (const walletTypeId of [1, 2, 3]) all.push({ assetTypeId, walletTypeId });

    for (let round = 0; round < 40; round++) {
      const accountId = 1 + (round % 8);
      const refs = all.filter(() => random() < 0.4);

      if (refs.length === 0) continue;

      const response = await service.getBalance({ clientId: 1, accountId, assets: refs });

      assert.deepEqual(response.balances, expectedBalances(books, 1, accountId, refs), `round ${round}`);
    }
  });

  it('answers only for the requested assets and omits one that has no book', async () => {
    const [first] = (await service.getBalances({ clientId: 1, accountId: 1 })).balances;
    const response = await service.getBalance({ clientId: 1, accountId: 1, assets: [{ assetTypeId: first.assetTypeId, walletTypeId: first.walletTypeId }, { assetTypeId: 99, walletTypeId: 1 }] });

    assert.equal(response.balances.length, 1);
    assert.equal(response.balances[0].assetTypeId, first.assetTypeId);
  });

  it('lists a requested asset once even if it was requested twice', async () => {
    const [first] = (await service.getBalances({ clientId: 1, accountId: 2 })).balances;
    const ref = { assetTypeId: first.assetTypeId, walletTypeId: first.walletTypeId };

    assert.equal((await service.getBalance({ clientId: 1, accountId: 2, assets: [ref, ref, ref] })).balances.length, 1);
  });

  it('does not mix wallet types: asking for one wallet type does not return the other', async () => {
    const withBothWallets = (await service.getBalances({ clientId: 1, accountId: 1 })).balances;
    const target = withBothWallets.find((entry) => withBothWallets.some((other) => other.assetTypeId === entry.assetTypeId && other.walletTypeId !== entry.walletTypeId));

    if (!target) return;

    const response = await service.getBalance({ clientId: 1, accountId: 1, assets: [{ assetTypeId: target.assetTypeId, walletTypeId: target.walletTypeId }] });

    assert.deepEqual(response.balances.map((entry) => entry.walletTypeId), [target.walletTypeId]);
  });

  it('returns nothing for an account that has no books', async () => {
    assert.deepEqual((await service.getBalances({ clientId: 1, accountId: 9999 })).balances, []);
  });
});
