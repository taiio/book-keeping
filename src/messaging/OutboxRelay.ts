import { autoInjectable, singleton } from 'tsyringe';

import { LedgerError } from '../common/errors';
import { MESSAGING_LIMITS } from '../constants';
import type { OutboxEventTypeId } from '../constants';
import { UnitOfWork } from '../common/UnitOfWork';
import { OutboxEventRepository } from '../repositories/OutboxEventRepository';
import type { OutboxEventView, OutboxRelaySummary } from '../types';
import { OutboxHandlerRegistry } from './OutboxHandlerRegistry';

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

    for (const event of events) {
      const view: OutboxEventView = event;

      try {
        await this.registry.get(event.eventType).handle(view);
        await this.unitOfWork.execute((tx) => this.outboxEventRepository.markPublished(event.id, tx));
        summary.published += 1;
      } catch (error) {
        await this.unitOfWork.execute((tx) => this.outboxEventRepository.recordFailure(event.id, errorMessage(error), !(error instanceof LedgerError) || error.retryable, tx));
        summary.failed += 1;
      }
    }

    return summary;
  }
}
