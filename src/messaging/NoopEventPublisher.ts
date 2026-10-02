import type { IEventPublisher } from '../ports';

/** Default publisher: drops events. Replace it with the Kafka producer by registering EVENT_PUBLISHER. */
export class NoopEventPublisher implements IEventPublisher {
  async publish(): Promise<void> {}
}
