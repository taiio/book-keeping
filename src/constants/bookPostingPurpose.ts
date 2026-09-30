import type { ValueOf } from '../types/common';

export const BOOK_POSTING_PURPOSE = {
  AMOUNT: 1,
  FEE: 2,
  REWARD: 3,
} as const;

export type BookPostingPurposeId = ValueOf<typeof BOOK_POSTING_PURPOSE>;
