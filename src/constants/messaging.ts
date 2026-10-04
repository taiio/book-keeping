import type { ValueOf } from '../types/common';
import { TRANSITION_OUTCOME } from './transition';
import type { TransitionOutcome } from './transition';

export const INBOX_EVENT_KIND = {
  SYSTEM_TRANSACTION: 1,
  BLOCKCHAIN_EVENT: 2,
} as const;

export type InboxEventKindId = ValueOf<typeof INBOX_EVENT_KIND>;

export const INBOX_EVENT_STATUS = {
  PENDING: 1,
  APPLIED: 2,
  DUPLICATE: 3,
  STALE: 4,
  CONFLICT: 5,
  ERROR: 6,
} as const;

export type InboxEventStatusId = ValueOf<typeof INBOX_EVENT_STATUS>;

export const OUTBOX_EVENT_TYPE = {
  STATE_CHANGED: 1,
  BROADCAST_REQUESTED: 2,
} as const;

export type OutboxEventTypeId = ValueOf<typeof OUTBOX_EVENT_TYPE>;

export const OUTBOX_EVENT_STATUS = {
  NEW: 1,
  PUBLISHED: 2,
  FAILED: 3,
} as const;

export type OutboxEventStatusId = ValueOf<typeof OUTBOX_EVENT_STATUS>;

export const INBOX_SOURCE = {
  BROADCAST_RELAY: 'broadcast-relay',
} as const;

export const SYSTEM_EVENT_NAME = {
  BROADCAST_REJECTED: 'broadcast-rejected',
} as const;

export const INBOX_STATUS_BY_OUTCOME: Readonly<Record<TransitionOutcome, InboxEventStatusId>> = {
  [TRANSITION_OUTCOME.APPLIED]: INBOX_EVENT_STATUS.APPLIED,
  [TRANSITION_OUTCOME.DUPLICATE]: INBOX_EVENT_STATUS.DUPLICATE,
  [TRANSITION_OUTCOME.STALE]: INBOX_EVENT_STATUS.STALE,
};

export const MESSAGING_LIMITS = {
  EVENT_ID_MAX_LENGTH: 64,
  INBOX_MAX_ATTEMPTS: 20,
  OUTBOX_MAX_ATTEMPTS: 10,
  OUTBOX_LEASE_MS: 30_000,
  BACKOFF_BASE_MS: 500,
  BACKOFF_MAX_MS: 60_000,
  PARK_MAX_AGE_MS: 6 * 60 * 60 * 1000,
  PARKED_RETRY_MS: 5_000,
  DRAIN_MAX_PASSES: 10,
} as const;
