function readInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function readString(name: string, defaultValue: string): string {
  return process.env[name] ?? defaultValue;
}

function readBool(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return defaultValue;
  return raw === 'true';
}

function readList(name: string, defaultValue: readonly string[]): readonly string[] {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const nodeEnv = readString('NODE_ENV', 'development');
const isProduction = nodeEnv === 'production';

export const env = {
  nodeEnv,

  log: {
    // error | warn | info | http | verbose | debug | silly | silent
    level: readString('LOG_LEVEL', isProduction ? 'info' : 'debug').toLowerCase(),
    // Coloured, human-readable output. Defaults to on outside production.
    colorize: readBool('LOG_COLORIZE', !isProduction),
    // One JSON object per line (for Loki / ELK / CloudWatch). Defaults to on in production.
    json: readBool('LOG_JSON', isProduction),
  },

  db: {
    host: readString('DB_HOST', 'localhost'),
    port: readInt('DB_PORT', 5433),
    name: readString('DB_NAME', 'bookkeeping'),
    user: readString('DB_USER', 'postgres'),
    password: readString('DB_PASSWORD', 'postgres'),
    logging: readString('DB_LOGGING', 'false') === 'true',

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

  kafka: {
    enabled: readBool('KAFKA_ENABLED', true),
    brokers: readList('KAFKA_BROKERS', ['localhost:9094']),
    clientId: readString('KAFKA_CLIENT_ID', 'bookkeeping'),
    groupId: readString('KAFKA_GROUP_ID', 'bookkeeping'),
    ssl: readBool('KAFKA_SSL', false),
    saslMechanism: readString('KAFKA_SASL_MECHANISM', ''),
    saslUsername: readString('KAFKA_SASL_USERNAME', ''),
    saslPassword: readString('KAFKA_SASL_PASSWORD', ''),
    fromBeginning: readBool('KAFKA_FROM_BEGINNING', false),
    systemTopic: readString('KAFKA_SYSTEM_TOPIC', 'bookkeeping.system-transactions'),
    blockchainTopic: readString('KAFKA_BLOCKCHAIN_TOPIC', 'bookkeeping.blockchain-events'),
    stateChangedTopic: readString('KAFKA_STATE_CHANGED_TOPIC', 'bookkeeping.state-changed'),
    deadLetterTopic: readString('KAFKA_DEAD_LETTER_TOPIC', 'bookkeeping.dlq'),
  },

  workers: {
    batchSize: readInt('WORKER_BATCH_SIZE', 100),
    inboxIntervalMs: readInt('WORKER_INBOX_INTERVAL_MS', 1_000),
    broadcastIntervalMs: readInt('WORKER_BROADCAST_INTERVAL_MS', 200),
    outboxIntervalMs: readInt('WORKER_OUTBOX_INTERVAL_MS', 500),
  },

  shutdownGracePeriodMs: readInt('SHUTDOWN_GRACE_PERIOD_MS', 10_000),
} as const;
