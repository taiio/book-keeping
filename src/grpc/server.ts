import path from 'path';

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

import { env } from '../config/env';
import { createBookkeepingServiceImplementation } from './bookkeepingService';

const PROTO_PATH = path.join(__dirname, '../../proto/bookkeeping.proto');

function loadServiceDefinition(): grpc.ServiceDefinition {
  const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: false, // snake_case (.proto) -> camelCase (JS/TS) tự động.
    longs: String,
    enums: String, // enum trên wire object trả về dạng string label (vd "EXTERNAL"), khớp thẳng với union type domain.
    defaults: true,
    oneofs: true,
  });

  const proto = grpc.loadPackageDefinition(packageDefinition) as unknown as {
    bookkeeping: { v1: { BookkeepingService: { service: grpc.ServiceDefinition } } };
  };

  return proto.bookkeeping.v1.BookkeepingService.service;
}

export interface GrpcServerHandle {
  server: grpc.Server;
  stop: () => Promise<void>;
}

export async function startGrpcServer(): Promise<GrpcServerHandle> {
  const server = new grpc.Server({
    'grpc.max_concurrent_streams': env.grpc.maxConcurrentStreams,
  });

  server.addService(loadServiceDefinition(), createBookkeepingServiceImplementation());

  const address = `${env.grpc.host}:${env.grpc.port}`;

  await new Promise<void>((resolve, reject) => {
    server.bindAsync(address, grpc.ServerCredentials.createInsecure(), (error, port) => {
      if (error) {
        reject(error);
        return;
      }
      console.log(`[grpc] BookkeepingService listening on ${env.grpc.host}:${port}`);
      resolve();
    });
  });

  const stop = () =>
    new Promise<void>((resolve) => {
      // tryShutdown: chờ các request đang xử lý dở hoàn tất (graceful),
      // KHÔNG cắt ngang — quan trọng khi scale ngang / rolling deploy, để
      // instance sắp bị kill không làm rớt request đang commit transaction.
      server.tryShutdown(() => resolve());
    });

  return { server, stop };
}
