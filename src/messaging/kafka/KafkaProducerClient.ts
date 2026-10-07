import type { Producer } from 'kafkajs';

import { createLogger } from '../../common/logger';
import type { OutboundMessage } from '../../types';
import { KafkaConnection } from './KafkaConnection';

const log = createLogger('kafka:producer');

export class KafkaProducerClient {
  private readonly producer: Producer;

  constructor(connection: KafkaConnection) {
    this.producer = connection.createProducer();
  }

  async connect(): Promise<void> {
    await this.producer.connect();
    log.info('producer connected');
  }

  async disconnect(): Promise<void> {
    await this.producer.disconnect();
    log.info('producer disconnected');
  }

  async send(topic: string, message: OutboundMessage): Promise<void> {
    await this.producer.send({ topic, messages: [{ key: message.key, value: message.value, headers: message.headers }] });

    log.debug('message sent', { topic, key: message.key });
  }
}
