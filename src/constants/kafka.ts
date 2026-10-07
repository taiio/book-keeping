import type { ValueOf } from '../types/common';

export const KAFKA_HEADER = {
  EVENT_ID: 'event-id',
} as const;

export const MESSAGE_OUTCOME = {
  ACK: 'ACK',
  RETRY: 'RETRY',
  DEAD_LETTER: 'DEAD_LETTER',
} as const;

export type MessageOutcome = ValueOf<typeof MESSAGE_OUTCOME>;

export const DEAD_LETTER_ORIGIN = {
  CONSUMER: 'CONSUMER',
  INBOX: 'INBOX',
  OUTBOX: 'OUTBOX',
} as const;

export type DeadLetterOrigin = ValueOf<typeof DEAD_LETTER_ORIGIN>;

export const DEAD_LETTER_STATE_ID = {
  INBOX: 1,
  OUTBOX: 2,
} as const;

export const DEAD_LETTER_HEADER = {
  ORIGIN: 'dlq-origin',
  REASON: 'dlq-reason',
  SOURCE: 'dlq-source',
  ATTEMPTS: 'dlq-attempts',
  TOPIC: 'dlq-topic',
  PARTITION: 'dlq-partition',
  OFFSET: 'dlq-offset',
} as const;

export const SASL_MECHANISM = {
  PLAIN: 'plain',
  SCRAM_SHA_256: 'scram-sha-256',
  SCRAM_SHA_512: 'scram-sha-512',
} as const;

export const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;
