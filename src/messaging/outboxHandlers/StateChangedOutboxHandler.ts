import { autoInjectable, inject, singleton } from 'tsyringe';

import { OUTBOX_EVENT_TYPE } from '../../constants';
import { EVENT_PUBLISHER } from '../../ports';
import type { IEventPublisher, OutboxEventHandler } from '../../ports';
import type { OutboxEventView } from '../../types';

@singleton()
@autoInjectable()
export class StateChangedOutboxHandler implements OutboxEventHandler {
  readonly type = OUTBOX_EVENT_TYPE.STATE_CHANGED;

  private readonly publisher: IEventPublisher;

  constructor(@inject(EVENT_PUBLISHER) publisher?: IEventPublisher) {
    this.publisher = publisher!;
  }

  handle(event: OutboxEventView): Promise<void> {
    return this.publisher.publish(event);
  }
}
