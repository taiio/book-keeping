import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { NotFoundError } from '../common/errors';
import { INBOX_EVENT_STATUS, MESSAGING_LIMITS, SORT_DIRECTION } from '../constants';
import type { InboxEventStatusId } from '../constants';
import { nextAttemptAfter } from '../helpers';
import { InboxEvent } from '../models';
import type { InboxOutcomeDetail, ReceiveInboxEventParams, ReceiveInboxEventResult } from '../types';

@singleton()
@autoInjectable()
export class InboxEventRepository {
  async receive(params: ReceiveInboxEventParams, tx: Transaction): Promise<ReceiveInboxEventResult> {
    const now = new Date();

    const [event, created] = await InboxEvent.findOrCreate({
      where: { eventId: params.eventId },
      defaults: {
        eventId: params.eventId,
        kind: params.kind,
        source: params.source ?? null,
        orderingKey: params.orderingKey,
        targetStateId: params.targetStateId,
        payload: params.payload,
        payloadHash: params.payloadHash,
        status: INBOX_EVENT_STATUS.PENDING,
        deliveryCount: 1,
        attempts: 0,
        firstReceivedAt: now,
        lastReceivedAt: now,
        nextAttemptAt: now,
      },
      transaction: tx,
    });
    console.log(`InboxEventRepository.receive: eventId=${params.eventId}, created=${created}, status=${event.status}`);
    if (created) return { event, created: true, conflict: false };

    const conflict = event.payloadHash !== params.payloadHash;

    await InboxEvent.increment('deliveryCount', { by: 1, where: { id: event.id }, transaction: tx });
    await InboxEvent.update(
      { lastReceivedAt: now, ...(conflict ? { lastError: `Redelivered with a different payload at ${now.toISOString()}` } : {}) },
      { where: { id: event.id }, transaction: tx },
    );

    return { event, created: false, conflict };
  }

  async lockById(id: string, tx: Transaction): Promise<InboxEvent> {
    const event = await InboxEvent.findByPk(id, { transaction: tx, lock: tx.LOCK.UPDATE });

    if (!event) throw new NotFoundError('InboxEvent', id);

    return event;
  }

  async findPending(limit: number, dueBefore?: Date): Promise<InboxEvent[]> {
    return InboxEvent.findAll({
      where: { status: INBOX_EVENT_STATUS.PENDING, ...(dueBefore ? { nextAttemptAt: { [Op.lte]: dueBefore } } : {}) },
      order: [['id', SORT_DIRECTION.ASC]],
      limit,
    });
  }

  async markOutcome(event: InboxEvent, status: InboxEventStatusId, detail: InboxOutcomeDetail, tx: Transaction): Promise<void> {
    event.status = status;
    event.journalTransactionId = detail.journalTransactionId ?? event.journalTransactionId;
    event.lastError = detail.error ?? null;
    event.appliedAt = status === INBOX_EVENT_STATUS.APPLIED ? new Date() : event.appliedAt;

    await event.save({ transaction: tx });
  }

  async scheduleRetry(event: InboxEvent, error: string, tx: Transaction): Promise<void> {
    event.attempts += 1;
    event.lastError = error;
    event.nextAttemptAt = nextAttemptAfter(event.attempts);

    await event.save({ transaction: tx });
  }

  async park(event: InboxEvent, reason: string, tx: Transaction): Promise<void> {
    event.lastError = reason;
    event.nextAttemptAt = new Date(Date.now() + MESSAGING_LIMITS.PARKED_RETRY_MS);

    await event.save({ transaction: tx });
  }
}
