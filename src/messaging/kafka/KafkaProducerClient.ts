import type { Producer } from 'kafkajs';

import type { OutboundMessage } from '../../types';
import { KafkaConnection } from './KafkaConnection';

export class KafkaProducerClient {
  private readonly producer: Producer;

  constructor(connection: KafkaConnection) {
    this.producer = connection.createProducer();
  }

  connect(): Promise<void> {
    return this.producer.connect();
  }

  disconnect(): Promise<void> {
    return this.producer.disconnect();
  }

  async send(topic: string, message: OutboundMessage): Promise<void> {
    await this.producer.send({ topic, messages: [{ key: message.key, value: message.value, headers: message.headers }] });
  }
}
