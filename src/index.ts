import 'reflect-metadata';

import { sequelize } from './config/database';
import { env } from './config/env';
import { SHUTDOWN_SIGNALS } from './constants';
import { startMessaging } from './messaging/runtime/startMessaging';
import type { MessagingRuntime } from './types';

function registerShutdown(messaging: MessagingRuntime | null): void {
  let closing = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;

    closing = true;
    console.log(`[shutdown] ${signal} received`);

    const forceExit = setTimeout(() => process.exit(1), env.shutdownGracePeriodMs);

    try {
      await messaging?.stop();
      await sequelize.close();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      console.error('[shutdown] failed', error);
      process.exit(1);
    }
  };

  for (const signal of SHUTDOWN_SIGNALS) process.once(signal, () => void shutdown(signal));
}

async function main(): Promise<void> {
  await sequelize.authenticate();
  console.log('[db] connection established');

  const messaging = env.kafka.enabled ? await startMessaging() : null;

  registerShutdown(messaging);
}

main().catch((error) => {
  console.error('[bootstrap] failed to start service', error);
  process.exit(1);
});
