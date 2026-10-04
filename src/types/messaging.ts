import type { InboxEventKindId, OutboxEventTypeId, TransitionOutcome } from '../constants';
import type { InboxEvent, OutboxEvent } from '../models';

export interface InboxEnvelope<TPayload> {
  eventId: string;
  source?: string;
  payload: TPayload;
}

export interface ReceiveInboxEventParams {
  eventId: string;
  kind: InboxEventKindId;
  source?: string;
  orderingKey: string;
  targetStateId: number | null;
  payload: unknown;
  payloadHash: string;
}

export interface ReceiveInboxEventResult {
  event: InboxEvent;
  created: boolean;
  conflict: boolean;
}

export interface InboxHandlerOutcome {
  outcome: TransitionOutcome;
  journalTransactionId: string | null;
}

export interface InboxOutcomeDetail {
  journalTransactionId?: string | null;
  error?: string | null;
}

export interface InboxProcessSummary {
  processed: number;
  applied: number;
  parked: number;
  failed: number;
}

export interface EnqueueOutboxEventParams {
  aggregate: string;
  eventType: OutboxEventTypeId;
  stateId: number;
  attempt: number;
  payload: unknown;
}

export interface StateChangedPayload {
  journalTransactionId: string;
  idempotencyToken: string;
  uuidToken: string;
  transactionTypeId: number;
  transactionStateId: number;
  journalTransactionState: number;
  transactionHash: string | null;
  attempt: number;
  synthetic: boolean;
}

export type OutboxEventView = Pick<OutboxEvent, 'id' | 'aggregate' | 'eventType' | 'stateId' | 'attempt' | 'payload'>;

export interface OutboxRelaySummary {
  claimed: number;
  published: number;
  failed: number;
}
