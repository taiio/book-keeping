import type { OutboxEventTypeId } from '../constants';
import type { OutboxEventView } from '../types';

export interface OutboxEventHandler {
  readonly type: OutboxEventTypeId;

  handle(event: OutboxEventView): Promise<void>;
}
