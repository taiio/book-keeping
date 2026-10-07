import { inject, singleton } from 'tsyringe';

import { KAFKA_HEADER, OUTBOX_EVENT_TYPE } from '../../constants';
import { deadLetterHeaders } from '../../helpers';
import { DEAD_LETTER_PUBLISHER } from '../../ports';
import type { IDeadLetterPublisher, OutboxEventHandler } from '../../ports';
import type { DeadLetterPayload, OutboxEventView } from '../../types';

@singleton()
export class DeadLetterOutboxHandler implements OutboxEventHandler {
  readonly type = OUTBOX_EVENT_TYPE.DEAD_LETTERED;

  private readonly publisher: IDeadLetterPublisher;

  constructor(@inject(DEAD_LETTER_PUBLISHER) publisher: IDeadLetterPublisher) {
    this.publisher = publisher;
  }

  handle(event: OutboxEventView): Promise<void> {
    const deadLetter = event.payload as DeadLetterPayload;

    return this.publisher.publish({
      key: deadLetter.key,
      value: JSON.stringify(deadLetter.payload),
      headers: { ...deadLetterHeaders(deadLetter), [KAFKA_HEADER.EVENT_ID]: deadLetter.eventId ?? '' },
    });
  }
}
