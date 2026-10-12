import { InvalidTransitionError } from '../common/errors';
import {
  CATCH_UP_PATHS,
  ENTRY_STATES,
  EXCEPTION_SOURCES,
  FORWARD_TRANSITIONS,
  JOURNAL_TRANSACTION_STATE,
  TRANSACTION_STATE_RANK,
  TRANSITION_DECISION,
} from '../constants';
import type { EvaluateParams, TransitionDecision } from '../types';
import { isExceptionState } from './transitionRules';

export class LedgerStateMachine {
  evaluate(params: EvaluateParams): TransitionDecision {
    const { transactionTypeId, currentStateId, targetStateId, journalTransactionId, journalTransactionState } = params;

    const invalid = () => new InvalidTransitionError(journalTransactionId, currentStateId, targetStateId);

    if (ENTRY_STATES[transactionTypeId] === undefined) throw invalid();

    if (currentStateId === targetStateId) return { kind: TRANSITION_DECISION.DUPLICATE };

    if (this.isLegal(transactionTypeId, currentStateId, targetStateId)) {
      if (journalTransactionState !== JOURNAL_TRANSACTION_STATE.ACTIVE) throw invalid();
      return { kind: TRANSITION_DECISION.APPLY };
    }

    if (currentStateId !== null && TRANSACTION_STATE_RANK[currentStateId] === undefined) throw invalid();

    const currentRank = currentStateId === null ? -1 : TRANSACTION_STATE_RANK[currentStateId];

    if (isExceptionState(targetStateId)) return this.evaluateException(transactionTypeId, targetStateId, currentRank, invalid);

    const targetRank = TRANSACTION_STATE_RANK[targetStateId];

    if (targetRank === undefined) throw invalid();

    if (targetRank < currentRank) return { kind: TRANSITION_DECISION.STALE };

    const via = currentStateId === null ? undefined : CATCH_UP_PATHS[transactionTypeId]?.[currentStateId]?.[targetStateId];

    return via ? { kind: TRANSITION_DECISION.CATCH_UP, via } : { kind: TRANSITION_DECISION.EARLY };
  }

  private isLegal(transactionTypeId: number, currentStateId: number | null, targetStateId: number): boolean {
    const forwardTargets = currentStateId === null ? [ENTRY_STATES[transactionTypeId]] : (FORWARD_TRANSITIONS[transactionTypeId]?.[currentStateId] ?? []);

    if (forwardTargets.includes(targetStateId)) return true;

    return (EXCEPTION_SOURCES[transactionTypeId]?.[targetStateId] ?? []).includes(currentStateId);
  }

  private evaluateException(transactionTypeId: number, targetStateId: number, currentRank: number, invalid: () => Error): TransitionDecision {
    const sourceRanks = (EXCEPTION_SOURCES[transactionTypeId]?.[targetStateId] ?? [])
      .filter((source): source is number => source !== null)
      .map((source) => TRANSACTION_STATE_RANK[source]);

    if (sourceRanks.length === 0) throw invalid();

    if (currentRank > Math.max(...sourceRanks)) throw invalid();

    if (currentRank < Math.min(...sourceRanks)) return { kind: TRANSITION_DECISION.EARLY };

    throw invalid();
  }
}
