export const HISTORY_EVENT_TYPE = {
  CREATED: 1,
  STATE_ADVANCED: 2,
  POSTING_APPLIED: 3,
  REJECTED_INVALID_TRANSITION: 4,
} as const;

export type HistoryEventType = (typeof HISTORY_EVENT_TYPE)[keyof typeof HISTORY_EVENT_TYPE];
