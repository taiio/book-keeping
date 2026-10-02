import { autoInjectable, singleton } from 'tsyringe';

import { isRetryable } from '../common/errors';
import { UnitOfWork } from '../common/UnitOfWork';
import { OutboxEventRepository } from '../repositories/OutboxEventRepository';
import type { OutboxEventView } from '../types';
import { OutboxHandlerRegistry } from './OutboxHandlerRegistry';

export interface OutboxRelaySummary {
  claimed: number;
  published: number;
  failed: number;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

/**
 * Delivers outbox events at least once. An event is leased in a short transaction, handled OUTSIDE any database
 * transaction (it calls the network), then marked published (or rescheduled) in another short transaction.
 */
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
        await this.unitOfWork.execute((tx) => this.outboxEventRepository.recordFailure(event.id, errorMessage(error), isRetryable(error) || !isLedgerError(error), tx));
        summary.failed += 1;
      }
    }

    return summary;
  }
}

/** Unknown errors (network, timeouts) are treated as transient; only ledger errors can declare themselves final. */
function isLedgerError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'disposition' in error;
}
