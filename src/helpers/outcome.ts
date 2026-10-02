import type { TransitionOutcome, TransitionResult } from '../types';

/** One outcome for a batch: APPLIED if anything was written, DUPLICATE if every request was a replay, else STALE. */
export function aggregateOutcome(results: readonly TransitionResult[]): TransitionOutcome {
  if (results.some((result) => result.outcome === 'APPLIED')) return 'APPLIED';

  if (results.length > 0 && results.every((result) => result.outcome === 'DUPLICATE')) return 'DUPLICATE';

  return 'STALE';
}
