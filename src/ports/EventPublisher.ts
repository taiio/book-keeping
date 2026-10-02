import type { OutboxEventView } from '../types';

/** Sends outbox events to the message bus (Kafka). Must tolerate being called more than once for the same event. */
export interface IEventPublisher {
  publish(event: OutboxEventView): Promise<void>;
}

export const EVENT_PUBLISHER = 'IEventPublisher';
