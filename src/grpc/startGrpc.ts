import { container } from '../config/container';
import { env } from '../config/env';
import type { Stoppable } from '../types';
import { BalanceGrpcHandler } from './BalanceGrpcHandler';
import { GrpcServer } from './GrpcServer';
import { isTlsConfigured } from './grpcCredentials';

export async function startGrpc(): Promise<Stoppable> {
  const server = new GrpcServer(container.resolve(BalanceGrpcHandler), env.grpc);
  const port = await server.start();

  if (!isTlsConfigured(env.grpc)) console.warn('[grpc] TLS is not configured: the server accepts plaintext connections');

  console.log(`[grpc] listening on ${env.grpc.host}:${port}`);

  return { stop: () => server.stop(env.shutdownGracePeriodMs) };
}
