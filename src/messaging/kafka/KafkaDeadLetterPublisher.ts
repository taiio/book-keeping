import type { IDeadLetterPublisher } from '../../ports';
import type { OutboundMessage } from '../../types';
import { KafkaProducerClient } from './KafkaProducerClient';

export class KafkaDeadLetterPublisher implements IDeadLetterPublisher {
  private readonly producer: KafkaProducerClient;
  private readonly topic: string;

  constructor(producer: KafkaProducerClient, topic: string) {
    this.producer = producer;
    this.topic = topic;
  }

  publish(message: OutboundMessage): Promise<void> {
    return this.producer.send(this.topic, message);
  }
}
