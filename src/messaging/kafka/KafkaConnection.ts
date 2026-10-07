import { Kafka, logLevel } from 'kafkajs';
import type { Consumer, Producer, SASLOptions } from 'kafkajs';

import { SASL_MECHANISM } from '../../constants';
import type { KafkaSettings } from '../../types';

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
