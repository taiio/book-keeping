import { autoInjectable, singleton } from 'tsyringe';

import { LedgerError } from '../common/errors';
import { createLogger, errorMeta } from '../common/logger';
import { outboxTypeName } from '../common/logLabels';
import { MESSAGING_LIMITS } from '../constants';
import type { OutboxEventTypeId } from '../constants';
import { UnitOfWork } from '../common/UnitOfWork';
import { OutboxEventRepository } from '../repositories/OutboxEventRepository';
import type { OutboxEventView, OutboxRelaySummary } from '../types';
import { OutboxHandlerRegistry } from './OutboxHandlerRegistry';

const log = createLogger('outbox');

const errorMessage = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

@singleton()
@autoInjectable()
export class OutboxRelay {
  private readonly unitOfWork: UnitOfWork;
  private readonly outboxEventRepository: OutboxEventRepository;
  private readonly registry: OutboxHandlerRegistry;

  constructor(unitOfWork?: UnitOfWork, outboxEventRepository?: OutboxEventRepository, registry?: OutboxHandlerRegistry) {
    this.unitOfWork = unitOfWork!;
    this.outboxEventRepository = outboxEventRepository!;
    this.registry = registry!;
  }

  async drain(limit = 100, eventTypes?: readonly OutboxEventTypeId[]): Promise<OutboxRelaySummary> {
    const total: OutboxRelaySummary = { claimed: 0, published: 0, failed: 0 };

    for (let pass = 0; pass < MESSAGING_LIMITS.DRAIN_MAX_PASSES; pass++) {
      const summary = await this.runOnce(limit, eventTypes);

      total.claimed += summary.claimed;
      total.published += summary.published;
      total.failed += summary.failed;

      if (summary.claimed === 0) break;
    }

    return total;
  }

  async runOnce(limit = 20, eventTypes?: readonly OutboxEventTypeId[]): Promise<OutboxRelaySummary> {
    const events = await this.unitOfWork.execute((tx) => this.outboxEventRepository.claimBatch(limit, tx, eventTypes));
    const summary: OutboxRelaySummary = { claimed: events.length, published: 0, failed: 0 };

    if (events.length > 0)
      log.debug('claimed outbox events', { count: events.length, types: [...new Set(events.map((event) => outboxTypeName(event.eventType)))] });

    for (const event of events) {
      const view: OutboxEventView = event;
      const detail = {
        id: event.id,
        type: outboxTypeName(event.eventType),
        aggregate: event.aggregate,
        stateId: event.stateId,
        attempt: event.attempts,
      };

      try {
        await this.registry.get(event.eventType).handle(view);
        await this.unitOfWork.execute((tx) => this.outboxEventRepository.markPublished(event.id, tx));
        summary.published += 1;

        log.info('event published', detail);
      } catch (error) {
        const retryable = !(error instanceof LedgerError) || error.retryable;

        await this.unitOfWork.execute((tx) => this.outboxEventRepository.recordFailure(event.id, errorMessage(error), retryable, tx));
        summary.failed += 1;

        const failure = {
          ...detail,
          maxAttempts: MESSAGING_LIMITS.OUTBOX_MAX_ATTEMPTS,
          willRetry: retryable,
          ...errorMeta(error, { stack: !(error instanceof LedgerError) }),
        };

        if (retryable) log.warn('event publish failed, will be retried', failure);
        else log.error('event publish failed permanently', failure);
      }
    }

    return summary;
  }
}
