import { TransitionNotReadyError } from '../../common/errors';
import { INBOX_EVENT_STATUS, MESSAGING_LIMITS, TRANSITION_OUTCOME } from '../../constants';
import type { InboxEventKindId, InboxEventStatusId } from '../../constants';
import type { FakeEvent } from './types';
import { nextAttemptAfter } from '../../helpers';
import type { InboxHandlerOutcome, InboxOutcomeDetail, ReceiveInboxEventParams } from '../../types';

export class FakeInboxRepository {
  readonly events: FakeEvent[] = [];

  async receive(params: ReceiveInboxEventParams) {
    const existing = this.events.find((event) => event.eventId === params.eventId);

    if (existing) {
      existing.deliveryCount += 1;
      return { event: existing, created: false, conflict: existing.payloadHash !== params.payloadHash };
    }

    const now = new Date();
    const event: FakeEvent = {
      id: String(this.events.length + 1),
      eventId: params.eventId,
      kind: params.kind,
      payload: params.payload,
      payloadHash: params.payloadHash,
      status: INBOX_EVENT_STATUS.PENDING,
      deliveryCount: 1,
      attempts: 0,
      journalTransactionId: null,
      lastError: null,
      firstReceivedAt: now,
      nextAttemptAt: now,
    };

    this.events.push(event);

    return { event, created: true, conflict: false };
  }

  async lockById(id: string) {
    return this.events.find((event) => event.id === id)!;
  }

  async findPending(limit: number, dueBefore?: Date) {
    return this.events.filter((event) => event.status === INBOX_EVENT_STATUS.PENDING && (!dueBefore || event.nextAttemptAt <= dueBefore)).slice(0, limit);
  }

  async markOutcome(event: FakeEvent, status: InboxEventStatusId, detail: InboxOutcomeDetail) {
    event.status = status;
    event.journalTransactionId = detail.journalTransactionId ?? event.journalTransactionId;
    event.lastError = detail.error ?? null;
  }

  async scheduleRetry(event: FakeEvent, error: string) {
    event.attempts += 1;
    event.lastError = error;
    event.nextAttemptAt = nextAttemptAfter(event.attempts);
  }

  async park(event: FakeEvent, reason: string) {
    event.lastError = reason;
    event.nextAttemptAt = new Date(Date.now() + MESSAGING_LIMITS.PARKED_RETRY_MS);
  }
}

export class FakeUnitOfWork {
  async execute<T>(work: (tx: unknown) => Promise<T>): Promise<T> {
    return work({});
  }
}

export class FakeLedger {
  readonly applied = new Set<string>();
  calls = 0;

  handler = {
    kind: 1 as InboxEventKindId,
    orderingKey: (payload: { key?: string }) => payload.key ?? 'k',
    targetStateId: () => 1,
    handle: async (payload: { id: string; needs?: string; fail?: Error; outcome?: InboxHandlerOutcome['outcome'] }): Promise<InboxHandlerOutcome> => {
      this.calls += 1;

      if (payload.fail) throw payload.fail;

      if (payload.needs && !this.applied.has(payload.needs)) {
        throw new TransitionNotReadyError(payload.id, null, 1);
      }

      this.applied.add(payload.id);

      return { outcome: payload.outcome ?? TRANSITION_OUTCOME.APPLIED, journalTransactionId: 7 };
    },
  };

  registry = { get: () => this.handler };
}
