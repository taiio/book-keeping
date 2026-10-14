import 'reflect-metadata';

import { sequelize } from './config/database';
import { env } from './config/env';
import { SHUTDOWN_SIGNALS } from './constants';
import { startGrpc } from './grpc/startGrpc';
import { startMessaging } from './messaging/runtime/startMessaging';
import type { Stoppable } from './types';

function registerShutdown(runtimes: readonly Stoppable[]): void {
  let closing = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;

    closing = true;
    console.log(`[shutdown] ${signal} received`);

    const forceExit = setTimeout(() => process.exit(1), env.shutdownGracePeriodMs);

    try {
      for (const runtime of [...runtimes].reverse()) await runtime.stop();

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

  const runtimes: Stoppable[] = [];

  if (env.grpc.enabled) runtimes.push(await startGrpc());

  if (env.kafka.enabled) runtimes.push(await startMessaging());

  registerShutdown(runtimes);
}

main().catch((error) => {
  console.error('[bootstrap] failed to start service', error);
  process.exit(1);
});
