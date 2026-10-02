import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { NotFoundError } from '../common/errors';
import { MESSAGING_LIMITS, OUTBOX_EVENT_STATUS } from '../constants';
import { nextAttemptAfter } from '../helpers';
import { OutboxEvent } from '../models';
import type { EnqueueOutboxEventParams } from '../types';

@singleton()
@autoInjectable()
export class OutboxEventRepository {
  /** Idempotent by (aggregate, type, state, attempt): enqueueing the same fact twice keeps one row. */
  async enqueue(params: EnqueueOutboxEventParams, tx: Transaction): Promise<OutboxEvent> {
    const now = new Date();

    const [event] = await OutboxEvent.findOrCreate({
      where: { aggregate: params.aggregate, eventType: params.eventType, stateId: params.stateId, attempt: params.attempt },
      defaults: {
        aggregate: params.aggregate,
        eventType: params.eventType,
        stateId: params.stateId,
        attempt: params.attempt,
        payload: params.payload,
        status: OUTBOX_EVENT_STATUS.NEW,
        attempts: 0,
        nextAttemptAt: now,
        createdAt: now,
      },
      transaction: tx,
    });

    return event;
  }

  /**
   * Leases a batch: rows are locked with SKIP LOCKED so relays do not fight over them, and made invisible until the
   * lease ends. A relay that dies simply lets the lease expire and the event is delivered again.
   */
  async claimBatch(limit: number, tx: Transaction, now: Date = new Date()): Promise<OutboxEvent[]> {
    const events = await OutboxEvent.findAll({
      where: { status: OUTBOX_EVENT_STATUS.NEW, nextAttemptAt: { [Op.lte]: now } },
      order: [['id', 'ASC']],
      limit,
      transaction: tx,
      lock: tx.LOCK.UPDATE,
      skipLocked: true,
    });

    for (const event of events) {
      event.attempts += 1;
      event.nextAttemptAt = new Date(now.getTime() + MESSAGING_LIMITS.OUTBOX_LEASE_MS);
      await event.save({ transaction: tx });
    }

    return events;
  }

  async markPublished(id: string, tx: Transaction): Promise<void> {
    const event = await this.lockById(id, tx);

    event.status = OUTBOX_EVENT_STATUS.PUBLISHED;
    event.publishedAt = new Date();
    event.lastError = null;

    await event.save({ transaction: tx });
  }

  /** Non-retryable errors, and retries that ran out, end as FAILED (needs a person). Otherwise try again later. */
  async recordFailure(id: string, error: string, retryable: boolean, tx: Transaction): Promise<void> {
    const event = await this.lockById(id, tx);

    event.lastError = error;

    if (!retryable || event.attempts >= MESSAGING_LIMITS.OUTBOX_MAX_ATTEMPTS) {
      event.status = OUTBOX_EVENT_STATUS.FAILED;
    } else {
      event.nextAttemptAt = nextAttemptAfter(event.attempts);
    }

    await event.save({ transaction: tx });
  }

  private async lockById(id: string, tx: Transaction): Promise<OutboxEvent> {
    const event = await OutboxEvent.findByPk(id, { transaction: tx, lock: tx.LOCK.UPDATE });

    if (!event) throw new NotFoundError('OutboxEvent', id);

    return event;
  }
}
