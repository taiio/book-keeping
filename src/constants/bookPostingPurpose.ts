export const BOOK_POSTING_PURPOSE = {
  AMOUNT: 1,
  FEE: 2,
  REWARD: 3,
} as const;

export type BookPostingPurposeId = (typeof BOOK_POSTING_PURPOSE)[keyof typeof BOOK_POSTING_PURPOSE];
