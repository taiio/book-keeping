import { Kafka, logLevel } from 'kafkajs';
import type { Consumer, LogEntry, Producer, SASLOptions } from 'kafkajs';

import { createLogger } from '../../common/logger';
import { SASL_MECHANISM } from '../../constants';
import type { KafkaSettings } from '../../types';

const kafkaLog = createLogger('kafkajs');

const KAFKAJS_LEVEL: Readonly<Record<number, 'error' | 'warn' | 'info' | 'debug'>> = {
  [logLevel.ERROR]: 'error',
  [logLevel.WARN]: 'warn',
  [logLevel.INFO]: 'info',
  [logLevel.DEBUG]: 'debug',
};

// kafkajs writes to the console by default; this hands its entries to winston instead.
const kafkaLogCreator = () => (entry: LogEntry) => {
  const { message, timestamp: _timestamp, logger: _logger, ...extra } = entry.log;

  kafkaLog.log(KAFKAJS_LEVEL[entry.level] ?? 'info', message, { namespace: entry.namespace, ...extra });
};

export class KafkaConnection {
  private readonly kafka: Kafka;
  private readonly settings: KafkaSettings;

  constructor(settings: KafkaSettings) {
    this.settings = settings;
    this.kafka = new Kafka({
      clientId: settings.clientId,
      brokers: [...settings.brokers],
      ssl: settings.ssl,
      sasl: this.sasl(),
      logLevel: logLevel.WARN,
      logCreator: kafkaLogCreator,
    });
  }

  createProducer(): Producer {
    return this.kafka.producer({ idempotent: true });
  }

  createConsumer(): Consumer {
    return this.kafka.consumer({ groupId: this.settings.groupId });
  }

  private sasl(): SASLOptions | undefined {
    const mechanism = Object.values(SASL_MECHANISM).find((candidate) => candidate === this.settings.saslMechanism);

    if (!mechanism) return undefined;

    return { mechanism, username: this.settings.saslUsername, password: this.settings.saslPassword } as SASLOptions;
  }
}
