import type { ValueOf } from '../types/common';

export const INBOX_EVENT_KIND = {
  SYSTEM_TRANSACTION: 1,
  BLOCKCHAIN_EVENT: 2,
} as const;

export type InboxEventKindId = ValueOf<typeof INBOX_EVENT_KIND>;

export const INBOX_EVENT_STATUS = {
  /** Received, not applied yet (also: parked because it arrived before its predecessor). */
  PENDING: 1,
  APPLIED: 2,
  /** The target state had already been applied: a replay. */
  DUPLICATE: 3,
  /** The journal transaction is already past the target state. */
  STALE: 4,
  /** The same event id came back with a different payload, or the ledger found conflicting data. */
  CONFLICT: 5,
  /** Cannot be applied and retrying will not help (or retries ran out). Needs a person. */
  ERROR: 6,
} as const;

export type InboxEventStatusId = ValueOf<typeof INBOX_EVENT_STATUS>;

export const OUTBOX_EVENT_TYPE = {
  /** A journal transaction reached a new state: tell the rest of the system. */
  STATE_CHANGED: 1,
  /** A withdraw reached SENT: put it on the blockchain. */
  BROADCAST_REQUESTED: 2,
} as const;

export type OutboxEventTypeId = ValueOf<typeof OUTBOX_EVENT_TYPE>;

export const OUTBOX_EVENT_STATUS = {
  NEW: 1,
  PUBLISHED: 2,
  FAILED: 3,
} as const;

export type OutboxEventStatusId = ValueOf<typeof OUTBOX_EVENT_STATUS>;

export const MESSAGING_LIMITS = {
  /** A parked inbox event is given up (status ERROR) after this many failed attempts. */
  INBOX_MAX_ATTEMPTS: 20,
  OUTBOX_MAX_ATTEMPTS: 10,
  /** How long a claimed outbox event stays invisible to other relays. */
  OUTBOX_LEASE_MS: 30_000,
  BACKOFF_BASE_MS: 500,
  BACKOFF_MAX_MS: 60_000,
  /** An event still waiting for its predecessor after this long is given up (status ERROR). */
  PARK_MAX_AGE_MS: 6 * 60 * 60 * 1000,
  /** How soon the periodic worker looks at a parked event again. */
  PARKED_RETRY_MS: 5_000,
  /** Safety cap for one drain of the parked inbox events. */
  DRAIN_MAX_PASSES: 10,
} as const;
