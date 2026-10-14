import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { join } from 'path';

import type { BalanceProto, GetBalanceRequest, GetBalanceResponse, GetBalancesRequest, GrpcSettings } from '../types';
import { BalanceGrpcHandler } from './BalanceGrpcHandler';
import { buildCredentials } from './grpcCredentials';

const PROTO_FILE = join(__dirname, '..', 'proto', 'balance.proto');

const LOADER_OPTIONS = { keepCase: false, longs: String, enums: String, defaults: true, oneofs: true };

export class GrpcServer {
  private readonly server: grpc.Server;
  private readonly settings: GrpcSettings;

  constructor(handler: BalanceGrpcHandler, settings: GrpcSettings) {
    this.settings = settings;
    this.server = new grpc.Server({ 'grpc.max_concurrent_streams': settings.maxConcurrentStreams });

    const loaded = grpc.loadPackageDefinition(protoLoader.loadSync(PROTO_FILE, LOADER_OPTIONS)) as unknown as BalanceProto;

    this.server.addService(loaded.bookkeeping.v1.BalanceService.service, {
      GetBalance: (call: grpc.ServerUnaryCall<GetBalanceRequest, GetBalanceResponse>, callback: grpc.sendUnaryData<GetBalanceResponse>) => handler.getBalance(call, callback),
      GetBalances: (call: grpc.ServerUnaryCall<GetBalancesRequest, GetBalanceResponse>, callback: grpc.sendUnaryData<GetBalanceResponse>) => handler.getBalances(call, callback),
    });
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.bindAsync(`${this.settings.host}:${this.settings.port}`, buildCredentials(this.settings), (error, port) => (error ? reject(error) : resolve(port)));
    });
  }

  stop(graceMs: number): Promise<void> {
    return new Promise((resolve) => {
      const forceTimer = setTimeout(() => {
        this.server.forceShutdown();
        resolve();
      }, graceMs);

      this.server.tryShutdown(() => {
        clearTimeout(forceTimer);
        resolve();
      });
    });
  }
}
