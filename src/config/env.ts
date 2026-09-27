/**
 * Đọc config tập trung tại 1 nơi (12-factor style): mọi giá trị "khác nhau
 * giữa các môi trường / instance" (host, port, pool size...) đều đi qua env
 * var, không hard-code rải rác. Điều này cần thiết để scale ngang: nhiều
 * instance của cùng 1 image chạy song song (vd sau load balancer / k8s
 * Deployment với replicas > 1) chỉ khác nhau ở env, không khác code.
 */
function readInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readString(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

export const env = {
  nodeEnv: readString('NODE_ENV', 'development'),

  db: {
    host: readString('DB_HOST', 'localhost'),
    port: readInt('DB_PORT', 5433),
    name: readString('DB_NAME', 'bookkeeping'),
    user: readString('DB_USER', 'postgres'),
    password: readString('DB_PASSWORD', 'postgres'),
    logging: readString('DB_LOGGING', 'true') === 'true',
    /**
     * Pool NÊN được cấu hình theo số instance đang chạy song song: tổng
     * (poolMax × số instance) không được vượt quá max_connections của
     * Postgres. Với N instance scale ngang, giảm poolMax tương ứng thay vì
     * giữ mặc định cho 1 instance duy nhất.
     */
    poolMax: readInt('DB_POOL_MAX', 20),
    poolMin: readInt('DB_POOL_MIN', 2),
    poolAcquireMs: readInt('DB_POOL_ACQUIRE_MS', 30_000),
    poolIdleMs: readInt('DB_POOL_IDLE_MS', 10_000),
  },

  grpc: {
    host: readString('GRPC_HOST', '0.0.0.0'),
    port: readInt('GRPC_PORT', 50051),
    /**
     * Giới hạn số connection đồng thời / instance — dùng cùng với health
     * check + readiness probe để load balancer / service mesh phân phối
     * đều tải giữa các instance khi scale ngang.
     */
    maxConcurrentStreams: readInt('GRPC_MAX_CONCURRENT_STREAMS', 200),
  },

  /** Thời gian tối đa chờ các request đang xử lý dở hoàn tất khi nhận SIGTERM/SIGINT trước khi force-exit. */
  shutdownGracePeriodMs: readInt('SHUTDOWN_GRACE_PERIOD_MS', 10_000),
} as const;
