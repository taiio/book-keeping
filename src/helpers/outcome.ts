import { TRANSITION_OUTCOME } from '../constants';
import type { TransitionOutcome } from '../constants';
import type { TransitionResult } from '../types';

export function aggregateOutcome(results: readonly TransitionResult[]): TransitionOutcome {
  if (results.some((result) => result.outcome === TRANSITION_OUTCOME.APPLIED)) return TRANSITION_OUTCOME.APPLIED;

  if (results.length > 0 && results.every((result) => result.outcome === TRANSITION_OUTCOME.DUPLICATE)) return TRANSITION_OUTCOME.DUPLICATE;

  return TRANSITION_OUTCOME.STALE;
}
