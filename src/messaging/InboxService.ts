import { autoInjectable, singleton } from 'tsyringe';

import { IdempotencyConflictError, ValidationError } from '../common/errors';
import { UnitOfWork } from '../common/UnitOfWork';
import { INBOX_EVENT_STATUS, MESSAGING_LIMITS } from '../constants';
import type { InboxEventKindId, InboxEventStatusId } from '../constants';
import { payloadHash } from '../helpers';
import { InboxEventRepository } from '../repositories/InboxEventRepository';
import type { InboxEnvelope } from '../types';
import { assertPresent } from '../validation';
import { InboxHandlerRegistry } from './InboxHandlerRegistry';
import { InboxProcessor } from './InboxProcessor';

@singleton()
@autoInjectable()
export class InboxService {
  private readonly unitOfWork: UnitOfWork;
  private readonly inboxEventRepository: InboxEventRepository;
  private readonly registry: InboxHandlerRegistry;
  private readonly processor: InboxProcessor;

  constructor(unitOfWork?: UnitOfWork, inboxEventRepository?: InboxEventRepository, registry?: InboxHandlerRegistry, processor?: InboxProcessor) {
    this.unitOfWork = unitOfWork!;
    this.inboxEventRepository = inboxEventRepository!;
    this.registry = registry!;
    this.processor = processor!;
  }

  async ingest<TPayload>(kind: InboxEventKindId, envelope: InboxEnvelope<TPayload>): Promise<InboxEventStatusId> {
    assertPresent(envelope.eventId, 'eventId');

    if (envelope.eventId.length > MESSAGING_LIMITS.EVENT_ID_MAX_LENGTH) throw new ValidationError(`eventId exceeds ${MESSAGING_LIMITS.EVENT_ID_MAX_LENGTH} characters`);

    const handler = this.registry.get(kind);

    const received = await this.unitOfWork.execute((tx) =>
      this.inboxEventRepository.receive(
        {
          eventId: envelope.eventId,
          kind,
          source: envelope.source,
          orderingKey: handler.orderingKey(envelope.payload),
          targetStateId: handler.targetStateId(envelope.payload),
          payload: envelope.payload,
          payloadHash: payloadHash(envelope.payload),
        },
        tx,
      ),
    );

    if (received.conflict) throw new IdempotencyConflictError(envelope.eventId, 'event id redelivered with a different payload');

    if (!received.created && received.event.status !== INBOX_EVENT_STATUS.PENDING) return received.event.status;

    const status = await this.processor.process(received.event.id);

    if (status === INBOX_EVENT_STATUS.APPLIED) await this.processor.drainParked();

    return status;
  }
}
