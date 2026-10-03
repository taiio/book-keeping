import { ValidationError } from '../common/errors';
import { POSTING_TOKEN } from '../constants';
import type { PostingTokenParts } from '../types';

export function bookPostingIdempotencyToken(parts: PostingTokenParts): string {
  const { journalIdempotencyToken, transactionTypeId, transactionStateId, attempt, index } = parts;

  if (attempt < POSTING_TOKEN.FIRST_ATTEMPT || index < POSTING_TOKEN.FIRST_INDEX) {
    throw new ValidationError(`attempt and index start at ${POSTING_TOKEN.FIRST_ATTEMPT}: attempt=${attempt}, index=${index}`);
  }

  const token = `${journalIdempotencyToken}-${attempt}-${transactionTypeId}-${transactionStateId}-${index}`;

  if (token.length > POSTING_TOKEN.MAX_LENGTH) {
    throw new ValidationError(`Posting idempotency token exceeds ${POSTING_TOKEN.MAX_LENGTH} characters: ${token}`);
  }

  return token;
}
