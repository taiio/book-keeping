import 'reflect-metadata';

import { sequelize } from './config/database';
import { env } from './config/env';
import { startGrpcServer, GrpcServerHandle } from './grpc/server';

async function main(): Promise<void> {
  await sequelize.authenticate();
  console.log('[db] connection established');

  const grpcHandle: GrpcServerHandle = await startGrpcServer();

  registerGracefulShutdown(grpcHandle);
}

/**
 * SIGTERM/SIGINT graceful shutdown — bắt buộc khi chạy nhiều instance sau
 * load balancer / orchestrator (k8s, ECS...): khi 1 instance bị scale-down
 * hoặc rolling-restart, nó nhận SIGTERM TRƯỚC khi bị kill hẳn. Nếu không
 * xử lý, các request đang xử lý dở (đang giữa 1 DB transaction) sẽ bị cắt
 * ngang giữa chừng. Ở đây: ngừng nhận request gRPC mới ngay lập tức
 * (server.tryShutdown không bind port mới), đợi request đang xử lý xong
 * (tối đa `shutdownGracePeriodMs`), rồi mới đóng connection pool DB.
 */
function registerGracefulShutdown(grpcHandle: GrpcServerHandle): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[shutdown] received ${signal}, draining...`);

    const forceExitTimer = setTimeout(() => {
      console.error('[shutdown] grace period exceeded, forcing exit');
      process.exit(1);
    }, env.shutdownGracePeriodMs);
    forceExitTimer.unref();

    try {
      await grpcHandle.stop();
      await sequelize.close();
      clearTimeout(forceExitTimer);
      console.log('[shutdown] clean exit');
      process.exit(0);
    } catch (error) {
      console.error('[shutdown] error while shutting down', error);
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((error) => {
  console.error('[bootstrap] failed to start service', error);
  process.exit(1);
});
