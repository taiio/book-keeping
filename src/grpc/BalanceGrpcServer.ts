import * as path from 'node:path';

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

import { env } from '../config/env';
import type { BalanceService } from '../ledger/BalanceService';
import type { ILogger } from '../ports';
import type { AccountBalanceView, GetBalanceQuery, GetBalancesQuery } from '../types';
import { toGrpcError } from './errors';

const PROTO_PATH = path.resolve(__dirname, 'proto/balance.proto');

interface GetBalancesRequestMessage {
  clientId: number;
  accountId: number;
}

interface GetBalanceRequestMessage extends GetBalancesRequestMessage {
  assets: { assetTypeId: number; walletTypeId: number }[];
}

interface BalanceProtoPackage {
  bookkeeping: { v1: { BalanceService: { service: grpc.ServiceDefinition } } };
}

export function toGetBalanceQuery(request: GetBalanceRequestMessage): GetBalanceQuery {
  return {
    clientId: request.clientId,
    accountId: request.accountId,
    assets: (request.assets ?? []).map((asset) => ({ assetTypeId: asset.assetTypeId, walletTypeId: asset.walletTypeId })),
  };
}

export function toGetBalancesQuery(request: GetBalancesRequestMessage): GetBalancesQuery {
  return { clientId: request.clientId, accountId: request.accountId };
}

export class BalanceGrpcServer {
  private readonly server: grpc.Server;
  private readonly balanceService: BalanceService;
  private readonly logger: ILogger;

  constructor(balanceService: BalanceService, logger: ILogger) {
    this.balanceService = balanceService;
    this.logger = logger;
    this.server = new grpc.Server({ 'grpc.max_concurrent_streams': env.grpc.maxConcurrentStreams });

    const definition = protoLoader.loadSync(PROTO_PATH, { keepCase: false, longs: String, enums: String, defaults: true, oneofs: true });
    const loaded = grpc.loadPackageDefinition(definition) as unknown as BalanceProtoPackage;

    this.server.addService(loaded.bookkeeping.v1.BalanceService.service, {
      GetBalance: (call: grpc.ServerUnaryCall<GetBalanceRequestMessage, AccountBalanceView>, callback: grpc.sendUnaryData<AccountBalanceView>) => {
        void this.serve('GetBalance', call.request, callback, (request) => this.balanceService.getBalance(toGetBalanceQuery(request)), {
          assets: call.request.assets?.length ?? 0,
        });
      },
      GetBalances: (call: grpc.ServerUnaryCall<GetBalancesRequestMessage, AccountBalanceView>, callback: grpc.sendUnaryData<AccountBalanceView>) => {
        void this.serve('GetBalances', call.request, callback, (request) => this.balanceService.getBalances(toGetBalancesQuery(request)));
      },
    });
  }

  start(): Promise<number> {
    const address = `${env.grpc.host}:${env.grpc.port}`;

    return new Promise((resolve, reject) => {
      // Plain-text: keep this behind the private network, or swap in ServerCredentials.createSsl for mTLS.
      this.server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error, port) => {
        if (error) return reject(error);

        this.logger.info('gRPC server listening', { address, port });
        resolve(port);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      const force = setTimeout(() => {
        this.server.forceShutdown();
        resolve();
      }, env.shutdownGracePeriodMs);

      this.server.tryShutdown(() => {
        clearTimeout(force);
        resolve();
      });
    });
  }

  private async serve<TRequest extends GetBalancesRequestMessage>(
    method: string,
    request: TRequest,
    callback: grpc.sendUnaryData<AccountBalanceView>,
    work: (request: TRequest) => Promise<AccountBalanceView>,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    const context = { method, clientId: request.clientId, accountId: request.accountId, ...extra };

    this.logger.info('gRPC request received', context);

    try {
      const result = await work(request);

      this.logger.info('gRPC request served', { ...context, assets: result.balances.length });
      callback(null, result);
    } catch (error) {
      const { code, message } = toGrpcError(error);

      if (code === grpc.status.INTERNAL) this.logger.error('gRPC request failed', { ...context, error: error instanceof Error ? error.stack : String(error) });
      else this.logger.warn('gRPC request rejected', { ...context, code, message });

      callback({ code, message });
    }
  }
}
