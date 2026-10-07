import { autoInjectable, singleton } from 'tsyringe';

import { UnsupportedOperationError } from '../common/errors';
import type { OutboxEventTypeId } from '../constants';
import type { OutboxEventHandler } from '../ports';
import { BroadcastOutboxHandler } from './outboxHandlers/BroadcastOutboxHandler';
import { DeadLetterOutboxHandler } from './outboxHandlers/DeadLetterOutboxHandler';
import { StateChangedOutboxHandler } from './outboxHandlers/StateChangedOutboxHandler';

@singleton()
@autoInjectable()
export class OutboxHandlerRegistry {
  private readonly handlers: ReadonlyMap<OutboxEventTypeId, OutboxEventHandler>;

  constructor(stateChanged?: StateChangedOutboxHandler, broadcast?: BroadcastOutboxHandler, deadLetter?: DeadLetterOutboxHandler) {
    const handlers: OutboxEventHandler[] = [stateChanged!, broadcast!, deadLetter!];

    this.handlers = new Map(handlers.map((handler) => [handler.type, handler]));
  }

  get(type: OutboxEventTypeId): OutboxEventHandler {
    const handler = this.handlers.get(type);

    if (!handler) throw new UnsupportedOperationError(`outbox event type ${type}`);

    return handler;
  }
}
