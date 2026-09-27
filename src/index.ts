import 'reflect-metadata';

import { sequelize } from './config/database';

async function main(): Promise<void> {
  await sequelize.authenticate();
  console.log('[db] connection established');

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

main().catch((error) => {
  console.error('[bootstrap] failed to start service', error);
  process.exit(1);
});
