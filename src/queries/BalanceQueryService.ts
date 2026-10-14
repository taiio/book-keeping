import { autoInjectable, singleton } from 'tsyringe';

import { BalanceRepository } from '../repositories/BalanceRepository';
import type { BalanceQuery, GetBalanceRequest, GetBalanceResponse, GetBalancesRequest } from '../types';
import { parseGetBalance, parseGetBalances } from '../validation';

@singleton()
@autoInjectable()
export class BalanceQueryService {
  private readonly balanceRepository: BalanceRepository;

  constructor(balanceRepository?: BalanceRepository) {
    this.balanceRepository = balanceRepository!;
  }

  async getBalance(request: GetBalanceRequest): Promise<GetBalanceResponse> {
    return this.answer(parseGetBalance(request));
  }

  async getBalances(request: GetBalancesRequest): Promise<GetBalanceResponse> {
    return this.answer(parseGetBalances(request));
  }

  private async answer(query: BalanceQuery): Promise<GetBalanceResponse> {
    return { clientId: query.clientId, accountId: query.accountId, balances: await this.balanceRepository.findBalances(query) };
  }
}
