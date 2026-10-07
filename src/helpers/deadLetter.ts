import { DEAD_LETTER_HEADER, DEAD_LETTER_ORIGIN, MESSAGING_LIMITS } from '../constants';
import type { InboxEvent, OutboxEvent } from '../models';
import type { DeadLetterPayload } from '../types';

export function deadLetterFromInbox(event: InboxEvent, reason: string): DeadLetterPayload {
  return {
    origin: DEAD_LETTER_ORIGIN.INBOX,
    reason,
    eventId: event.eventId,
    key: event.orderingKey,
    kind: event.kind,
    source: event.source,
    attempts: event.attempts,
    payload: event.payload,
  };
}

export function deadLetterFromOutbox(event: OutboxEvent, reason: string): DeadLetterPayload {
  return {
    origin: DEAD_LETTER_ORIGIN.OUTBOX,
    reason,
    eventId: String(event.id),
    key: event.aggregate,
    kind: event.eventType,
    source: null,
    attempts: event.attempts,
    payload: event.payload,
  };
}

export function deadLetterHeaders(payload: DeadLetterPayload): Record<string, string> {
  return {
    [DEAD_LETTER_HEADER.ORIGIN]: payload.origin,
    [DEAD_LETTER_HEADER.REASON]: payload.reason.slice(0, MESSAGING_LIMITS.DEAD_LETTER_REASON_MAX_LENGTH),
    [DEAD_LETTER_HEADER.SOURCE]: payload.source ?? '',
    [DEAD_LETTER_HEADER.ATTEMPTS]: String(payload.attempts),
  };
}
