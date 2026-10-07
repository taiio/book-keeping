import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { NotFoundError } from '../common/errors';
import { DEAD_LETTER_STATE_ID, MESSAGING_LIMITS, OUTBOX_EVENT_STATUS, OUTBOX_EVENT_TYPE, POSTING_TOKEN, SORT_DIRECTION } from '../constants';
import type { OutboxEventTypeId } from '../constants';
import { deadLetterFromOutbox, nextAttemptAfter } from '../helpers';
import { OutboxEvent } from '../models';
import type { EnqueueOutboxEventParams } from '../types';

@singleton()
@autoInjectable()
export class OutboxEventRepository {
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

  async claimBatch(limit: number, tx: Transaction, eventTypes?: readonly OutboxEventTypeId[], now: Date = new Date()): Promise<OutboxEvent[]> {
    const events = await OutboxEvent.findAll({
      where: { status: OUTBOX_EVENT_STATUS.NEW, nextAttemptAt: { [Op.lte]: now }, ...(eventTypes ? { eventType: [...eventTypes] } : {}) },
      order: [['id', SORT_DIRECTION.ASC]],
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

  async recordFailure(id: string, error: string, retryable: boolean, tx: Transaction): Promise<void> {
    const event = await this.lockById(id, tx);

    event.lastError = error;

    if (!retryable || event.attempts >= MESSAGING_LIMITS.OUTBOX_MAX_ATTEMPTS) {
      event.status = OUTBOX_EVENT_STATUS.FAILED;

      if (event.eventType !== OUTBOX_EVENT_TYPE.DEAD_LETTERED) {
        await this.enqueue(
          {
            aggregate: String(event.id),
            eventType: OUTBOX_EVENT_TYPE.DEAD_LETTERED,
            stateId: DEAD_LETTER_STATE_ID.OUTBOX,
            attempt: POSTING_TOKEN.FIRST_ATTEMPT,
            payload: deadLetterFromOutbox(event, error),
          },
          tx,
        );
      }
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
