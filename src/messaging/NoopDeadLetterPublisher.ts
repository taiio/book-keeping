import type { IDeadLetterPublisher } from '../ports';

export class NoopDeadLetterPublisher implements IDeadLetterPublisher {
  async publish(): Promise<void> {}
}
