import * as assert from 'node:assert/strict';

import { ValidationError } from '../../common/errors';
import { TRANSACTION_STATE } from '../../constants';
import { toGetBalanceQuery, toGetBalancesQuery } from '../../grpc/BalanceGrpcServer';
import { BalanceService } from '../../ledger/BalanceService';
import type { Book } from '../../models';
import type { BookRepository } from '../../repositories/BookRepository';
import type { FindCustodyBooksParams } from '../../types';

const S = TRANSACTION_STATE;

const book = (assetTypeId: number, assetTicker: string, stateId: number, amount: string, walletTypeId = 1): Book =>
  ({ assetId: assetTypeId, assetTypeId, walletTypeId, assetTicker, transactionStateId: stateId, amount }) as unknown as Book;

function serviceWith(books: Book[]) {
  const calls: FindCustodyBooksParams[] = [];
  const repository = {
    findCustodyBooks: async (params: FindCustodyBooksParams) => {
      calls.push(params);
      return books;
    },
  } as unknown as BookRepository;

  return { service: new BalanceService(repository), calls };
}

const USDT_BOOKS = [
  book(1, 'USDT', S.AUTHORIZING.id, '300'),
  book(1, 'USDT', S.CONFIRMING.id, '50'),
  book(1, 'USDT', S.CONFIRMED.id, '700'),
  book(2, 'ETH', S.CONFIRMED.id, '5'),
];

describe('BalanceService.getBalances', () => {
  it('balance is CONFIRMED only, availableBalance sums every non-null state', async () => {
    const { service, calls } = serviceWith(USDT_BOOKS);

    const result = await service.getBalances({ clientId: 1, accountId: 1 });

    assert.deepEqual(calls[0], { clientId: 1, accountId: 1 });
    assert.deepEqual(result.balances, [
      { assetId: 1, assetTypeId: 1, walletTypeId: 1, assetTicker: 'USDT', balance: '700', availableBalance: '1050' },
      { assetId: 2, assetTypeId: 2, walletTypeId: 1, assetTicker: 'ETH', balance: '5', availableBalance: '5' },
    ]);
  });

  it('balance is 0 when there is no CONFIRMED book yet', async () => {
    const { service } = serviceWith([book(1, 'USDT', S.CONFIRMING.id, '40')]);

    const [usdt] = (await service.getBalances({ clientId: 1, accountId: 1 })).balances;

    assert.equal(usdt.balance, '0');
    assert.equal(usdt.availableBalance, '40');
  });

  it('keeps amounts above Number.MAX_SAFE_INTEGER exact', async () => {
    const huge = '123456789012345678901234567890';
    const { service } = serviceWith([book(1, 'USDT', S.CONFIRMED.id, huge), book(1, 'USDT', S.SENT.id, '10')]);

    const [usdt] = (await service.getBalances({ clientId: 1, accountId: 1 })).balances;

    assert.equal(usdt.balance, huge);
    assert.equal(usdt.availableBalance, '123456789012345678901234567900');
  });

  it('separates the same asset type across wallet types', async () => {
    const { service } = serviceWith([book(1, 'USDT', S.CONFIRMED.id, '1', 1), book(1, 'USDT', S.CONFIRMED.id, '2', 2)]);

    assert.equal((await service.getBalances({ clientId: 1, accountId: 1 })).balances.length, 2);
  });

  it('rejects an invalid account', async () => {
    const { service } = serviceWith([]);

    await assert.rejects(service.getBalances({ clientId: 0, accountId: 1 }), ValidationError);
    await assert.rejects(service.getBalances({ clientId: 1, accountId: 1.5 }), ValidationError);
  });
});

describe('BalanceService.getBalance', () => {
  it('queries only the requested assets (deduped)', async () => {
    const { service, calls } = serviceWith(USDT_BOOKS.slice(0, 3));

    const result = await service.getBalance({
      clientId: 1,
      accountId: 2,
      assets: [
        { assetTypeId: 1, walletTypeId: 1 },
        { assetTypeId: 1, walletTypeId: 1 },
      ],
    });

    assert.deepEqual(calls[0], { clientId: 1, accountId: 2, assets: [{ assetTypeId: 1, walletTypeId: 1 }] });
    assert.equal(result.balances.length, 1);
    assert.equal(result.balances[0].balance, '700');
    assert.equal(result.balances[0].availableBalance, '1050');
  });

  it('requires at least one valid asset', async () => {
    const { service } = serviceWith([]);

    await assert.rejects(service.getBalance({ clientId: 1, accountId: 1, assets: [] }), ValidationError);
    await assert.rejects(service.getBalance({ clientId: 1, accountId: 1, assets: [{ assetTypeId: 0, walletTypeId: 1 }] }), ValidationError);
    await assert.rejects(service.getBalance({ clientId: 1, accountId: 1, assets: [{ assetTypeId: 1, walletTypeId: 0 }] }), ValidationError);
    await assert.rejects(
      service.getBalance({ clientId: 1, accountId: 1, assets: Array.from({ length: 101 }, (_, i) => ({ assetTypeId: i + 1, walletTypeId: 1 })) }),
      ValidationError,
    );
  });
});

describe('request mapping', () => {
  it('maps proto messages to queries', () => {
    assert.deepEqual(toGetBalanceQuery({ clientId: 1, accountId: 2, assets: [{ assetTypeId: 3, walletTypeId: 4 }] }), {
      clientId: 1,
      accountId: 2,
      assets: [{ assetTypeId: 3, walletTypeId: 4 }],
    });
    assert.deepEqual(toGetBalancesQuery({ clientId: 1, accountId: 2 }), { clientId: 1, accountId: 2 });
  });
});
