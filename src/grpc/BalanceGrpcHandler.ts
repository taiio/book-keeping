import type { sendUnaryData, ServerUnaryCall } from '@grpc/grpc-js';
import { autoInjectable, singleton } from 'tsyringe';

import { BalanceQueryService } from '../queries/BalanceQueryService';
import type { GetBalanceRequest, GetBalanceResponse, GetBalancesRequest } from '../types';
import { toGrpcError } from './grpcError';

@singleton()
@autoInjectable()
export class BalanceGrpcHandler {
  private readonly balanceQueryService: BalanceQueryService;

  constructor(balanceQueryService?: BalanceQueryService) {
    this.balanceQueryService = balanceQueryService!;
  }

  getBalance(call: ServerUnaryCall<GetBalanceRequest, GetBalanceResponse>, callback: sendUnaryData<GetBalanceResponse>): void {
    this.reply(() => this.balanceQueryService.getBalance(call.request), callback);
  }

  getBalances(call: ServerUnaryCall<GetBalancesRequest, GetBalanceResponse>, callback: sendUnaryData<GetBalanceResponse>): void {
    this.reply(() => this.balanceQueryService.getBalances(call.request), callback);
  }

  private reply(answer: () => Promise<GetBalanceResponse>, callback: sendUnaryData<GetBalanceResponse>): void {
    Promise.resolve()
      .then(answer)
      .then(
        (response) => callback(null, response),
        (error: unknown) => callback(toGrpcError(error), null),
      );
  }
}
