import { TRANSACTION_STATE } from '../constants';
import type { AssetBalance, BalanceBook } from '../types';

interface Total {
  balance: AssetBalance;
  confirmed: bigint;
  all: bigint;
}

export function foldBalances(books: readonly BalanceBook[]): AssetBalance[] {
  const totals = new Map<string, Total>();

  for (const book of books) {
    if (book.transactionStateId === null) continue;

    const key = JSON.stringify([book.assetTypeId, book.walletTypeId, book.assetId, book.assetTicker]);

    const total = totals.get(key) ?? {
      balance: { assetId: book.assetId, assetTypeId: book.assetTypeId, walletTypeId: book.walletTypeId, assetTicker: book.assetTicker, balance: '0', availableBalance: '0' },
      confirmed: 0n,
      all: 0n,
    };

    const amount = BigInt(book.amount);

    total.all += amount;

    if (book.transactionStateId === TRANSACTION_STATE.CONFIRMED.id) total.confirmed += amount;

    totals.set(key, total);
  }

  return [...totals.values()].map(({ balance, confirmed, all }) => ({ ...balance, balance: confirmed.toString(), availableBalance: all.toString() }));
}
