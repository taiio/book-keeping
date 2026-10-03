import { autoInjectable, singleton } from 'tsyringe';

import { LedgerError } from '../common/errors';
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

  async runOnce(limit = 20): Promise<OutboxRelaySummary> {
    const events = await this.unitOfWork.execute((tx) => this.outboxEventRepository.claimBatch(limit, tx));
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
