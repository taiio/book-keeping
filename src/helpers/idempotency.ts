import { ValidationError } from '../common/errors';

/** Every posting is written under attempt 1 until a replay mechanism bumps it. */
export const DEFAULT_ATTEMPT = 1;

/** `book_posting.idempotency_token` is VARCHAR(64). */
export const MAX_POSTING_TOKEN_LENGTH = 64;

export interface PostingTokenParts {
  journalIdempotencyToken: string;
  transactionTypeId: number;
  transactionStateId: number;
  /** Starts at 1. */
  attempt: number;
  /** Starts at 1; position of the posting inside one (journal transaction, state, attempt). */
  index: number;
}

/**
 * Deterministic token of one posting: `{jtToken}-{type}-{state}-{attempt}-{index}`.
 * The same input always yields the same token, which is what makes a message replay a no-op.
 */
export function bookPostingIdempotencyToken(parts: PostingTokenParts): string {
  const { journalIdempotencyToken, transactionTypeId, transactionStateId, attempt, index } = parts;

  if (attempt < 1 || index < 1) {
    throw new ValidationError(`attempt and index start at 1: attempt=${attempt}, index=${index}`);
  }

  const token = `${journalIdempotencyToken}-${attempt}-${transactionTypeId}-${transactionStateId}-${index}`;

  if (token.length > MAX_POSTING_TOKEN_LENGTH) {
    throw new ValidationError(`Posting idempotency token exceeds ${MAX_POSTING_TOKEN_LENGTH} characters: ${token}`);
  }

  return token;
}
