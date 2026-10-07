import type { InboxEventKindId, InboxEventStatusId } from '../../constants';

export interface FakeEvent {
  id: string;
  eventId: string;
  kind: InboxEventKindId;
  orderingKey: string;
  source: string | null;
  payload: any;
  payloadHash: string;
  status: InboxEventStatusId;
  deliveryCount: number;
  attempts: number;
  journalTransactionId: string | null;
  lastError: string | null;
  firstReceivedAt: Date;
  nextAttemptAt: Date;
}
