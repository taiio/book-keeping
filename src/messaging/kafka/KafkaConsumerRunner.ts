import type { Consumer } from 'kafkajs';

import { KafkaConnection } from './KafkaConnection';
import { KafkaMessageHandler } from './KafkaMessageHandler';
import { toConsumedMessage } from './consumedMessage';

export class KafkaConsumerRunner {
  private readonly consumer: Consumer;
  private readonly handler: KafkaMessageHandler;
  private readonly topics: readonly string[];
  private readonly fromBeginning: boolean;

  constructor(connection: KafkaConnection, handler: KafkaMessageHandler, topics: readonly string[], fromBeginning: boolean) {
    this.consumer = connection.createConsumer();
    this.handler = handler;
    this.topics = topics;
    this.fromBeginning = fromBeginning;
  }

  async start(): Promise<void> {
    await this.consumer.connect();
    await this.consumer.subscribe({ topics: [...this.topics], fromBeginning: this.fromBeginning });
    await this.consumer.run({
      eachMessage: ({ topic, partition, message }) => this.handler.handle(toConsumedMessage(topic, partition, message)),
    });
  }

  async stop(): Promise<void> {
    await this.consumer.stop();
    await this.consumer.disconnect();
  }
}
