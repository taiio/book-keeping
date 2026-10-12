import 'reflect-metadata';

import { container } from 'tsyringe';

import { sequelize } from './config/database';
import { env } from './config/env';
import { logger } from './config/logger';
import { SHUTDOWN_SIGNALS } from './constants';
import { BalanceGrpcServer } from './grpc/BalanceGrpcServer';
import { BalanceService } from './ledger/BalanceService';
import { startMessaging } from './messaging/runtime/startMessaging';
import type { MessagingRuntime } from './types';

function registerShutdown(messaging: MessagingRuntime | null, grpcServer: BalanceGrpcServer): void {
  let closing = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;

    closing = true;
    logger.info('shutdown signal received', { signal });

    const forceExit = setTimeout(() => process.exit(1), env.shutdownGracePeriodMs);

    try {
      await grpcServer.stop();
      await messaging?.stop();
      await sequelize.close();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      logger.error('shutdown failed', { error: error instanceof Error ? error.stack : String(error) });
      process.exit(1);
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) process.once(signal, () => void shutdown(signal));
}

async function main(): Promise<void> {
  await sequelize.authenticate();
  logger.info('db connection established');

  const messaging = env.kafka.enabled ? await startMessaging() : null;

  const grpcServer = new BalanceGrpcServer(container.resolve(BalanceService), logger);
  await grpcServer.start();

  registerShutdown(messaging, grpcServer);
}

main().catch((error) => {
  logger.error('failed to start service', { error: error instanceof Error ? error.stack : String(error) });
  process.exit(1);
});
