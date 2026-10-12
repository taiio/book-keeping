import { autoInjectable, singleton } from 'tsyringe';

import { ValidationError } from '../common/errors';
import { TRANSACTION_STATE } from '../constants';
import type { Book } from '../models';
import { BookRepository } from '../repositories/BookRepository';
import type { AccountBalanceView, AssetBalanceView, AssetRef, GetBalanceQuery, GetBalancesQuery } from '../types';

const MAX_ASSETS_PER_REQUEST = 100;

const isPositiveInt = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0;

@singleton()
@autoInjectable()
export class BalanceService {
  private readonly bookRepository: BookRepository;

  constructor(bookRepository?: BookRepository) {
    this.bookRepository = bookRepository!;
  }

  /** Balances of the requested assets only. */
  async getBalance(query: GetBalanceQuery): Promise<AccountBalanceView> {
    this.validateAccount(query);

    const assets = this.validateAssets(query.assets);
    const books = await this.bookRepository.findCustodyBooks({ clientId: query.clientId, accountId: query.accountId, assets });

    return { clientId: query.clientId, accountId: query.accountId, balances: this.aggregate(books) };
  }

  /** Balances of every asset the account holds. */
  async getBalances(query: GetBalancesQuery): Promise<AccountBalanceView> {
    this.validateAccount(query);

    const books = await this.bookRepository.findCustodyBooks({ clientId: query.clientId, accountId: query.accountId });

    return { clientId: query.clientId, accountId: query.accountId, balances: this.aggregate(books) };
  }

  /**
   * balance          = custody book in state CONFIRMED
   * availableBalance = sum of every custody book with a non-null state
   */
  private aggregate(books: Book[]): AssetBalanceView[] {
    const byAsset = new Map<string, { view: AssetBalanceView; available: bigint }>();

    for (const book of books) {
      if (book.transactionStateId === null) continue;

      const key = `${book.assetTypeId}:${book.walletTypeId}`;

      let entry = byAsset.get(key);
      if (!entry) {
        entry = {
          view: {
            assetId: book.assetId,
            assetTypeId: book.assetTypeId,
            walletTypeId: book.walletTypeId,
            assetTicker: book.assetTicker,
            balance: '0',
            availableBalance: '0',
          },
          available: 0n,
        };
        byAsset.set(key, entry);
      }

      const amount = String(book.amount ?? '0');

      if (book.transactionStateId === TRANSACTION_STATE.CONFIRMED.id) entry.view.balance = amount;

      entry.available += BigInt(amount);
    }

    return [...byAsset.values()].map(({ view, available }) => ({ ...view, availableBalance: available.toString() }));
  }

  private validateAccount(query: { clientId: number; accountId: number }): void {
    if (!isPositiveInt(query.clientId)) throw new ValidationError(`clientId must be a positive integer: ${String(query.clientId)}`);
    if (!isPositiveInt(query.accountId)) throw new ValidationError(`accountId must be a positive integer: ${String(query.accountId)}`);
  }

  private validateAssets(assets: AssetRef[] | undefined): AssetRef[] {
    if (!assets || assets.length === 0) throw new ValidationError('assets must contain at least one asset');
    if (assets.length > MAX_ASSETS_PER_REQUEST) throw new ValidationError(`at most ${MAX_ASSETS_PER_REQUEST} assets are allowed per request`);

    const unique = new Map<string, AssetRef>();

    for (const asset of assets) {
      if (!isPositiveInt(asset?.assetTypeId)) throw new ValidationError(`assetTypeId must be a positive integer: ${String(asset?.assetTypeId)}`);
      if (!isPositiveInt(asset?.walletTypeId)) throw new ValidationError(`walletTypeId must be a positive integer: ${String(asset?.walletTypeId)}`);

      unique.set(`${asset.assetTypeId}:${asset.walletTypeId}`, { assetTypeId: asset.assetTypeId, walletTypeId: asset.walletTypeId });
    }

    return [...unique.values()];
  }
}
