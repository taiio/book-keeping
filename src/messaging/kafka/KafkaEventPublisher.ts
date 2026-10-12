import { KAFKA_HEADER, SYSTEM_EVENT_NAME } from '../../constants';
import { deterministicUuid } from '../../helpers';
import type { IEventPublisher } from '../../ports';
import type { OutboxEventView } from '../../types';
import { KafkaProducerClient } from './KafkaProducerClient';

export class KafkaEventPublisher implements IEventPublisher {
  private readonly producer: KafkaProducerClient;
  private readonly topic: string;

  constructor(producer: KafkaProducerClient, topic: string) {
    this.producer = producer;
    this.topic = topic;
  }

  publish(event: OutboxEventView): Promise<void> {
    return this.producer.send(this.topic, {
      key: event.aggregate,
      value: JSON.stringify(event.payload),
      headers: { [KAFKA_HEADER.EVENT_ID]: deterministicUuid(`${SYSTEM_EVENT_NAME.STATE_CHANGED}:${event.aggregate}:${event.stateId}:${event.attempt}`) },
    });
  }
}
