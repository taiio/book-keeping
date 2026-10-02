import type { Transaction } from 'sequelize';

import type { InboxEventKindId } from '../constants';
import type { InboxHandlerOutcome } from '../types';

/** What the inbox needs to know about one kind of message. One implementation per kind. */
export interface InboxEventHandler<TPayload = unknown> {
  readonly kind: InboxEventKindId;

  /** Kafka message key: messages with the same key are ordered. */
  orderingKey(payload: TPayload): string;

  targetStateId(payload: TPayload): number | null;

  /** Applies the message inside the caller's DB transaction, so "applied" and "inbox marked applied" commit together. */
  handle(payload: TPayload, tx: Transaction): Promise<InboxHandlerOutcome>;
}
