import { autoInjectable, singleton } from 'tsyringe';

import { IdempotencyConflictError, isRetryable, LedgerError, TransactionHashConflictError, TransitionNotReadyError } from '../common/errors';
import { createLogger, errorMeta } from '../common/logger';
import { inboxKindName, inboxStatusName, stateName } from '../common/logLabels';
import { UnitOfWork } from '../common/UnitOfWork';
import { DEAD_LETTER_STATE_ID, INBOX_EVENT_STATUS, INBOX_STATUS_BY_OUTCOME, MESSAGING_LIMITS, OUTBOX_EVENT_TYPE, POSTING_TOKEN } from '../constants';
import type { InboxEventStatusId } from '../constants';
import { deadLetterFromInbox } from '../helpers';
import type { InboxEvent } from '../models';
import { InboxEventRepository } from '../repositories/InboxEventRepository';
import { OutboxEventRepository } from '../repositories/OutboxEventRepository';
import type { InboxProcessSummary } from '../types';
import { InboxHandlerRegistry } from './InboxHandlerRegistry';

const log = createLogger('inbox');

const errorMessage = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

@singleton()
@autoInjectable()
export class InboxProcessor {
  private readonly unitOfWork: UnitOfWork;
  private readonly inboxEventRepository: InboxEventRepository;
  private readonly registry: InboxHandlerRegistry;
  private readonly outboxEventRepository: OutboxEventRepository;

  constructor(
    unitOfWork?: UnitOfWork,
    inboxEventRepository?: InboxEventRepository,
    registry?: InboxHandlerRegistry,
    outboxEventRepository?: OutboxEventRepository,
  ) {
    this.unitOfWork = unitOfWork!;
    this.inboxEventRepository = inboxEventRepository!;
    this.registry = registry!;
    this.outboxEventRepository = outboxEventRepository!;
  }

  async process(eventId: string): Promise<InboxEventStatusId> {
    const startedAt = Date.now();

    try {
      const result = await this.unitOfWork.execute(async (tx) => {
        const event = await this.inboxEventRepository.lockById(eventId, tx);

        if (event.status !== INBOX_EVENT_STATUS.PENDING) return { status: event.status, event, handled: false as const, journalTransactionId: null };

        const { outcome, journalTransactionId } = await this.registry.get(event.kind).handle(event.payload, tx);
        const status = INBOX_STATUS_BY_OUTCOME[outcome];

        await this.inboxEventRepository.markOutcome(event, status, { journalTransactionId }, tx);

        return { status, event, handled: true as const, journalTransactionId };
      });

      const detail = {
        eventId: result.event.eventId,
        kind: inboxKindName(result.event.kind),
        orderingKey: result.event.orderingKey,
        targetState: stateName(result.event.targetStateId),
        status: inboxStatusName(result.status),
      };

      // Logged after the commit, so a line saying APPLIED really is in the database.
      if (result.handled)
        log.info('event processed', { ...detail, journalTransactionId: result.journalTransactionId, durationMs: Date.now() - startedAt });
      else log.debug('event already settled, nothing to do', detail);

      return result.status;
    } catch (error) {
      return this.recordFailure(eventId, error);
    }
  }

  drainParked(limit = 100): Promise<InboxProcessSummary> {
    return this.drain(() => this.inboxEventRepository.findPending(limit));
  }

  processDue(limit = 100): Promise<InboxProcessSummary> {
    return this.drain(() => this.inboxEventRepository.findPending(limit, new Date()));
  }

  private async drain(load: () => Promise<InboxEvent[]>): Promise<InboxProcessSummary> {
    const summary: InboxProcessSummary = { processed: 0, applied: 0, parked: 0, failed: 0 };

    for (let pass = 0; pass < MESSAGING_LIMITS.DRAIN_MAX_PASSES; pass++) {
      const events = await load();

      if (events.length === 0) break;

      let progressed = false;
      summary.parked = 0;

      for (const event of events) {
        const status = await this.process(event.id);

        summary.processed += 1;

        if (status === INBOX_EVENT_STATUS.APPLIED) {
          summary.applied += 1;
          progressed = true;
        } else if (status === INBOX_EVENT_STATUS.PENDING) {
          summary.parked += 1;
        } else if (status === INBOX_EVENT_STATUS.ERROR || status === INBOX_EVENT_STATUS.CONFLICT) {
          summary.failed += 1;
        }
      }

      if (!progressed) break;
    }

    return summary;
  }

  private recordFailure(eventId: string, error: unknown): Promise<InboxEventStatusId> {
    const message = errorMessage(error);

    return this.unitOfWork.execute(async (tx) => {
      const event = await this.inboxEventRepository.lockById(eventId, tx);

      if (event.status !== INBOX_EVENT_STATUS.PENDING) {
        log.debug('event failed but was settled by someone else, nothing to record', {
          eventId: event.eventId,
          status: inboxStatusName(event.status),
        });
        return event.status;
      }

      if (error instanceof IdempotencyConflictError || error instanceof TransactionHashConflictError) {
        await this.deadLetter(event, INBOX_EVENT_STATUS.CONFLICT, message, tx);
      } else if (error instanceof LedgerError && !isRetryable(error)) {
        await this.deadLetter(event, INBOX_EVENT_STATUS.ERROR, message, tx);
      } else if (error instanceof TransitionNotReadyError) {
        await this.parkOrGiveUp(event, message, tx);
      } else if (event.attempts + 1 >= MESSAGING_LIMITS.INBOX_MAX_ATTEMPTS) {
        await this.deadLetter(event, INBOX_EVENT_STATUS.ERROR, `Retries exhausted. ${message}`, tx);
      } else {
        await this.inboxEventRepository.scheduleRetry(event, message, tx);

        log.warn('event failed, retry scheduled', {
          eventId: event.eventId,
          kind: inboxKindName(event.kind),
          attempt: event.attempts,
          maxAttempts: MESSAGING_LIMITS.INBOX_MAX_ATTEMPTS,
          nextAttemptAt: event.nextAttemptAt,
          ...errorMeta(error, { stack: !(error instanceof LedgerError) }),
        });
      }

      return event.status;
    });
  }

  private async parkOrGiveUp(event: InboxEvent, message: string, tx: Parameters<InboxEventRepository['park']>[2]): Promise<void> {
    if (Date.now() - event.firstReceivedAt.getTime() > MESSAGING_LIMITS.PARK_MAX_AGE_MS) {
      await this.deadLetter(event, INBOX_EVENT_STATUS.ERROR, `Waited too long for a predecessor. ${message}`, tx);
      return;
    }

    await this.inboxEventRepository.park(event, message, tx);

    log.warn('event parked: waiting for a predecessor', {
      eventId: event.eventId,
      kind: inboxKindName(event.kind),
      orderingKey: event.orderingKey,
      targetState: stateName(event.targetStateId),
      waitingMs: Date.now() - event.firstReceivedAt.getTime(),
      reason: message,
    });
  }

  private async deadLetter(
    event: InboxEvent,
    status: InboxEventStatusId,
    reason: string,
    tx: Parameters<InboxEventRepository['park']>[2],
  ): Promise<void> {
    await this.inboxEventRepository.markOutcome(event, status, { error: reason }, tx);

    log.error('event dead-lettered', {
      eventId: event.eventId,
      kind: inboxKindName(event.kind),
      orderingKey: event.orderingKey,
      targetState: stateName(event.targetStateId),
      status: inboxStatusName(status),
      attempts: event.attempts,
      reason,
    });

    await this.outboxEventRepository.enqueue(
      {
        aggregate: event.eventId,
        eventType: OUTBOX_EVENT_TYPE.DEAD_LETTERED,
        stateId: DEAD_LETTER_STATE_ID.INBOX,
        attempt: POSTING_TOKEN.FIRST_ATTEMPT,
        payload: deadLetterFromInbox(event, reason),
      },
      tx,
    );
  }
}
