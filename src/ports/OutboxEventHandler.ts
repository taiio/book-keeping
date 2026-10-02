import type { OutboxEventTypeId } from '../constants';
import type { OutboxEventView } from '../types';

/** Performs the side effect of one kind of outbox event. Throwing a retryable error makes the relay try again later. */
export interface OutboxEventHandler {
  readonly type: OutboxEventTypeId;

  handle(event: OutboxEventView): Promise<void>;
}
