import type { InboxEventKindId, InboxEventStatusId } from '../../constants';

export interface FakeEvent {
  id: string;
  eventId: string;
  kind: InboxEventKindId;
  payload: any;
  payloadHash: string;
  status: InboxEventStatusId;
  deliveryCount: number;
  attempts: number;
  journalTransactionId: number | null;
  lastError: string | null;
  firstReceivedAt: Date;
  nextAttemptAt: Date;
}
