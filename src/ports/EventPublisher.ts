import type { OutboxEventView } from '../types';

export interface IEventPublisher {
  publish(event: OutboxEventView): Promise<void>;
}

export const EVENT_PUBLISHER = 'IEventPublisher';
