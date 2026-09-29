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

    poolMax: readInt('DB_POOL_MAX', 20),
    poolMin: readInt('DB_POOL_MIN', 2),
    poolAcquireMs: readInt('DB_POOL_ACQUIRE_MS', 30_000),
    poolIdleMs: readInt('DB_POOL_IDLE_MS', 10_000),
  },

  grpc: {
    host: readString('GRPC_HOST', '0.0.0.0'),
    port: readInt('GRPC_PORT', 50051),

    maxConcurrentStreams: readInt('GRPC_MAX_CONCURRENT_STREAMS', 200),
  },

  shutdownGracePeriodMs: readInt('SHUTDOWN_GRACE_PERIOD_MS', 10_000),
} as const;
