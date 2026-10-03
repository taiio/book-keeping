import { MESSAGING_LIMITS } from '../constants';

export function backoffMs(attempts: number): number {
  const delay = MESSAGING_LIMITS.BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1);

  return Math.min(delay, MESSAGING_LIMITS.BACKOFF_MAX_MS);
}

export const nextAttemptAfter = (attempts: number, now: Date = new Date()): Date => new Date(now.getTime() + backoffMs(attempts));
