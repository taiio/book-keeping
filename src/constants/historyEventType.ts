import type { ValueOf } from '../types/common';

export const HISTORY_EVENT_TYPE = {
  CREATED: 1,
  STATE_ADVANCED: 2,
  POSTING_APPLIED: 3,
  /** A state applied on behalf of an event that never arrived (e.g. CONFIRMING implied by CONFIRMED). */
  STATE_CAUGHT_UP: 4,
} as const;

export type HistoryEventTypeId = ValueOf<typeof HISTORY_EVENT_TYPE>;
