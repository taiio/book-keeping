import 'reflect-metadata';

import { createLogger, errorMeta } from './common/logger';
import { sequelize } from './config/database';
import { env } from './config/env';
import { SHUTDOWN_SIGNALS } from './constants';
import { startMessaging } from './messaging/runtime/startMessaging';
import type { MessagingRuntime } from './types';

const log = createLogger('app');

function registerShutdown(messaging: MessagingRuntime | null): void {
  let closing = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;

    closing = true;
    log.info('shutdown signal received', { signal, gracePeriodMs: env.shutdownGracePeriodMs });

    const forceExit = setTimeout(() => {
      log.error('graceful shutdown timed out, forcing exit', { gracePeriodMs: env.shutdownGracePeriodMs });
      process.exit(1);
    }, env.shutdownGracePeriodMs);

    try {
      await messaging?.stop();
      log.debug('messaging stopped');

      await sequelize.close();
      log.debug('database connection closed');

      clearTimeout(forceExit);
      log.info('shutdown completed');
      process.exit(0);
    } catch (error) {
      log.error('shutdown failed', errorMeta(error));
      process.exit(1);
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) process.once(signal, () => void shutdown(signal));
}

async function main(): Promise<void> {
  log.info('starting service', { nodeEnv: env.nodeEnv, logLevel: env.log.level, kafkaEnabled: env.kafka.enabled });

  await sequelize.authenticate();
  log.info('database connection established', { host: env.db.host, port: env.db.port, database: env.db.name, poolMax: env.db.poolMax });

  if (!env.kafka.enabled) log.warn('kafka is disabled (KAFKA_ENABLED=false): no consumer, inbox worker or outbox worker will run');

  const messaging = env.kafka.enabled ? await startMessaging() : null;

  registerShutdown(messaging);
}

process.on('unhandledRejection', (reason) => {
  log.error('unhandled promise rejection', errorMeta(reason));
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  log.error('uncaught exception', errorMeta(error));
  process.exit(1);
});

main().catch((error) => {
  log.error('failed to start service', errorMeta(error));
  process.exit(1);
});
