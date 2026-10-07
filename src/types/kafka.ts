import type { env } from '../config/env';
import type { DeadLetterOrigin, InboxEventKindId, MessageOutcome } from '../constants';
import type { InboxEnvelope } from './messaging';

export type KafkaSettings = typeof env.kafka;

export interface TopicRoute {
  topic: string;
  kind: InboxEventKindId;
}

export interface ConsumedMessage {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
}

export interface DecodedMessage {
  kind: InboxEventKindId;
  envelope: InboxEnvelope<unknown>;
}

export interface MessageDecision {
  outcome: MessageOutcome;
  reason: string;
}

export interface OutboundMessage {
  key: string | null;
  value: string;
  headers: Record<string, string>;
}

export interface DeadLetterPayload {
  origin: DeadLetterOrigin;
  reason: string;
  eventId: string | null;
  key: string | null;
  kind: number | null;
  source: string | null;
  attempts: number;
  payload: unknown;
}

export interface RawKafkaMessage {
  key: Buffer | null;
  value: Buffer | null;
  offset: string;
  headers?: Record<string, Buffer | string | Array<Buffer | string> | undefined>;
}

export interface MessagingRuntime {
  stop(): Promise<void>;
}
