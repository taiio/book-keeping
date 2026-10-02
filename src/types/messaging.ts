import type { InboxEventKindId, OutboxEventTypeId } from '../constants';
import type { InboxEvent, OutboxEvent } from '../models';
import type { TransitionOutcome } from './ledger';

/** What a producer hands to the consumer: the producer-set event id plus the business payload. */
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
  /** False when the event id had been received before (a replay). */
  created: boolean;
  /** True when the event id came back with a different payload. */
  conflict: boolean;
}

export interface InboxHandlerOutcome {
  outcome: TransitionOutcome;
  journalTransactionId: number | null;
}

export interface InboxOutcomeDetail {
  journalTransactionId?: number | null;
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

/** The business content of a STATE_CHANGED outbox event. */
export interface StateChangedPayload {
  journalTransactionId: number;
  idempotencyToken: string;
  uuidToken: string;
  transactionTypeId: number;
  transactionStateId: number;
  journalTransactionState: number;
  transactionHash: string | null;
  attempt: number;
  /** True when the state was applied on behalf of an event that never arrived. */
  synthetic: boolean;
}

export type OutboxEventView = Pick<OutboxEvent, 'id' | 'aggregate' | 'eventType' | 'stateId' | 'attempt' | 'payload'>;

