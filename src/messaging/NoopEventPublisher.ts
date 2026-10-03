import type { IEventPublisher } from '../ports';

export class NoopEventPublisher implements IEventPublisher {
  async publish(): Promise<void> {}
}
