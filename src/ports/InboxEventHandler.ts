import type { Transaction } from 'sequelize';

import type { InboxEventKindId } from '../constants';
import type { InboxHandlerOutcome } from '../types';

export interface InboxEventHandler<TPayload = unknown> {
  readonly kind: InboxEventKindId;

  orderingKey(payload: TPayload): string;

  targetStateId(payload: TPayload): number | null;

  handle(payload: TPayload, tx: Transaction): Promise<InboxHandlerOutcome>;
}
