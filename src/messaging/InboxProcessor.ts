import { autoInjectable, singleton } from 'tsyringe';

import { IdempotencyConflictError, isRetryable, LedgerError, TransactionHashConflictError, TransitionNotReadyError } from '../common/errors';
import { UnitOfWork } from '../common/UnitOfWork';
import { INBOX_EVENT_STATUS, INBOX_STATUS_BY_OUTCOME, MESSAGING_LIMITS } from '../constants';
import type { InboxEventStatusId } from '../constants';
import type { InboxEvent } from '../models';
import { InboxEventRepository } from '../repositories/InboxEventRepository';
import type { InboxProcessSummary } from '../types';
import { InboxHandlerRegistry } from './InboxHandlerRegistry';

const errorMessage = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

@singleton()
@autoInjectable()
export class InboxProcessor {
  private readonly unitOfWork: UnitOfWork;
  private readonly inboxEventRepository: InboxEventRepository;
  private readonly registry: InboxHandlerRegistry;

  constructor(unitOfWork?: UnitOfWork, inboxEventRepository?: InboxEventRepository, registry?: InboxHandlerRegistry) {
    this.unitOfWork = unitOfWork!;
    this.inboxEventRepository = inboxEventRepository!;
    this.registry = registry!;
  }

  async process(eventId: string): Promise<InboxEventStatusId> {
    try {
      return await this.unitOfWork.execute(async (tx) => {
        const event = await this.inboxEventRepository.lockById(eventId, tx);

        if (event.status !== INBOX_EVENT_STATUS.PENDING) return event.status;

        const { outcome, journalTransactionId } = await this.registry.get(event.kind).handle(event.payload, tx);
        const status = INBOX_STATUS_BY_OUTCOME[outcome];

        await this.inboxEventRepository.markOutcome(event, status, { journalTransactionId }, tx);

        return status;
      });
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

      if (event.status !== INBOX_EVENT_STATUS.PENDING) return event.status;

      if (error instanceof IdempotencyConflictError || error instanceof TransactionHashConflictError) {
        await this.inboxEventRepository.markOutcome(event, INBOX_EVENT_STATUS.CONFLICT, { error: message }, tx);
      } else if (error instanceof LedgerError && !isRetryable(error)) {
        await this.inboxEventRepository.markOutcome(event, INBOX_EVENT_STATUS.ERROR, { error: message }, tx);
      } else if (error instanceof TransitionNotReadyError) {
        await this.parkOrGiveUp(event, message, tx);
      } else if (event.attempts + 1 >= MESSAGING_LIMITS.INBOX_MAX_ATTEMPTS) {
        await this.inboxEventRepository.markOutcome(event, INBOX_EVENT_STATUS.ERROR, { error: `Retries exhausted. ${message}` }, tx);
      } else {
        await this.inboxEventRepository.scheduleRetry(event, message, tx);
      }

      return event.status;
    });
  }

  private async parkOrGiveUp(event: InboxEvent, message: string, tx: Parameters<InboxEventRepository['park']>[2]): Promise<void> {
    if (Date.now() - event.firstReceivedAt.getTime() > MESSAGING_LIMITS.PARK_MAX_AGE_MS) {
      await this.inboxEventRepository.markOutcome(event, INBOX_EVENT_STATUS.ERROR, { error: `Waited too long for a predecessor. ${message}` }, tx);
      return;
    }

    await this.inboxEventRepository.park(event, message, tx);
  }
}
