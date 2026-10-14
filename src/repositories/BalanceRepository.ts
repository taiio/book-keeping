import { autoInjectable, singleton } from 'tsyringe';

import { foldBalances } from '../helpers';
import { Book } from '../models';
import type { AssetBalance, BalanceQuery } from '../types';
import { buildBalanceCriteria } from './balanceCriteria';

@singleton()
@autoInjectable()
export class BalanceRepository {
  async findBalances(query: BalanceQuery): Promise<AssetBalance[]> {
    const books = await Book.findAll(buildBalanceCriteria(query));

    return foldBalances(books);
  }
}
