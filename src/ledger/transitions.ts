import { BOOK_PURPOSE, JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';
import type { JournalTransactionStateId } from '../constants';
import { InvalidTransitionError } from '../common/errors';
import type { BookRef } from '../types/book';

const S = TRANSACTION_STATE;
const J = JOURNAL_TRANSACTION_STATE;

/** A double-entry movement: value leaves `from` and lands in `to`. */
export interface Movement {
  from: BookRef;
  to: BookRef;
}

/**
 * One legal step of a journal transaction's life cycle.
 * `from === null` is the entry edge (journal has no state yet).
 * `movement === null` is a "void" edge: the journal is closed but nothing was ever posted.
 */
export interface TransitionEdge {
  type: number;
  from: number | null;
  to: number;
  movement: Movement | null;
  /** Alternative movement for FEE legs whose fee was really burnt on-chain (mined-but-failed tx). */
  consumedFeeMovement?: Movement;
  /** Journal state that the journal reaches by taking this edge (ACTIVE when omitted). */
  journalStateAfter?: JournalTransactionStateId;
}

export const custody = (stateId: number): BookRef => ({ bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id, transactionStateId: stateId });
export const external = (): BookRef => ({ bookPurposeId: BOOK_PURPOSE.BLOCKCHAIN_EXTERNAL_ACCOUNT.id, transactionStateId: null });

export const isExternalRef = (ref: BookRef): boolean => ref.bookPurposeId === BOOK_PURPOSE.BLOCKCHAIN_EXTERNAL_ACCOUNT.id;

const refund = (fromState: number): Movement => ({ from: custody(fromState), to: custody(S.CONFIRMED.id) });
const burn = (fromState: number): Movement => ({ from: custody(fromState), to: external() });

/**
 * SINGLE source of truth for the ledger life cycle (replaces the three divergent tables that used to live in
 * constants/transactionState.ts, LedgerStateMachine.ts and ledgerMovements.ts).
 */
export const TRANSITION_EDGES: readonly TransitionEdge[] = [
  // ---- WITHDRAW (sender side) -------------------------------------------------------------------------------
  { type: TRANSACTION_TYPE.WITHDRAW, from: null, to: S.AUTHORIZING.id, movement: { from: custody(S.CONFIRMED.id), to: custody(S.AUTHORIZING.id) } },
  {
    type: TRANSACTION_TYPE.WITHDRAW,
    from: S.AUTHORIZING.id,
    to: S.AUTHORIZED.id,
    movement: { from: custody(S.AUTHORIZING.id), to: custody(S.AUTHORIZED.id) },
  },
  { type: TRANSACTION_TYPE.WITHDRAW, from: S.AUTHORIZED.id, to: S.SENT.id, movement: { from: custody(S.AUTHORIZED.id), to: custody(S.SENT.id) } },
  { type: TRANSACTION_TYPE.WITHDRAW, from: S.SENT.id, to: S.CONFIRMING.id, movement: { from: custody(S.SENT.id), to: custody(S.CONFIRMING.id) } },
  {
    type: TRANSACTION_TYPE.WITHDRAW,
    from: S.CONFIRMING.id,
    to: S.CONFIRMED.id,
    movement: burn(S.CONFIRMING.id),
    journalStateAfter: J.COMPLETED,
  },
  // exception paths: funds go back to the spendable (CONFIRMED) book
  { type: TRANSACTION_TYPE.WITHDRAW, from: S.AUTHORIZING.id, to: S.REJECTED.id, movement: refund(S.AUTHORIZING.id), journalStateAfter: J.REJECTED },
  { type: TRANSACTION_TYPE.WITHDRAW, from: S.AUTHORIZED.id, to: S.REJECTED.id, movement: refund(S.AUTHORIZED.id), journalStateAfter: J.REJECTED },
  {
    type: TRANSACTION_TYPE.WITHDRAW,
    from: S.SENT.id,
    to: S.FAILED.id,
    movement: refund(S.SENT.id),
    consumedFeeMovement: burn(S.SENT.id),
    journalStateAfter: J.FAILED,
  },
  {
    type: TRANSACTION_TYPE.WITHDRAW,
    from: S.CONFIRMING.id,
    to: S.FAILED.id,
    movement: refund(S.CONFIRMING.id),
    consumedFeeMovement: burn(S.CONFIRMING.id),
    journalStateAfter: J.FAILED,
  },

  // ---- DEPOSIT (recipient side) -----------------------------------------------------------------------------
  { type: TRANSACTION_TYPE.DEPOSIT, from: null, to: S.CONFIRMING.id, movement: { from: external(), to: custody(S.CONFIRMING.id) } },
  {
    type: TRANSACTION_TYPE.DEPOSIT,
    from: S.CONFIRMING.id,
    to: S.CONFIRMED.id,
    movement: { from: custody(S.CONFIRMING.id), to: custody(S.CONFIRMED.id) },
    journalStateAfter: J.COMPLETED,
  },
  // chain re-org / dropped tx: give the pending credit back to the external book
  {
    type: TRANSACTION_TYPE.DEPOSIT,
    from: S.CONFIRMING.id,
    to: S.FAILED.id,
    movement: { from: custody(S.CONFIRMING.id), to: external() },
    journalStateAfter: J.FAILED,
  },
  // recipient journal pre-created by an internal withdraw that never reached the chain: close it, nothing was posted
  { type: TRANSACTION_TYPE.DEPOSIT, from: null, to: S.FAILED.id, movement: null, journalStateAfter: J.FAILED },
  { type: TRANSACTION_TYPE.DEPOSIT, from: null, to: S.REJECTED.id, movement: null, journalStateAfter: J.REJECTED },
];

/** Happy-path order, used to recognise stale / duplicate messages. */
const HAPPY_RANK: Readonly<Record<number, number>> = {
  [S.AUTHORIZING.id]: 0,
  [S.AUTHORIZED.id]: 1,
  [S.SENT.id]: 2,
  [S.CONFIRMING.id]: 3,
  [S.CONFIRMED.id]: 4,
};

/**
 * States that are only ever *observed* from the chain, so they may be skipped when an event is lost or arrives out of
 * order (e.g. CONFIRMED delivered before CONFIRMING). Authorisation / submission states can never be skipped.
 */
const SKIPPABLE_STATES: ReadonlySet<number> = new Set([S.CONFIRMING.id]);

const FAILURE_STATES: ReadonlySet<number> = new Set([S.FAILED.id, S.REJECTED.id]);

export type TransitionPlan = { kind: 'noop'; reason: 'duplicate' | 'stale' } | { kind: 'apply'; hops: TransitionEdge[] };

function findEdge(type: number, from: number | null, to: number): TransitionEdge | undefined {
  return TRANSITION_EDGES.find((edge) => edge.type === type && edge.from === from && edge.to === to);
}

/**
 * Decide what a requested transition means for a journal that is currently at `current`.
 *  - same state again            -> noop (at-least-once delivery)
 *  - older happy-path state      -> noop (out-of-order delivery)
 *  - direct edge / skippable gap -> apply (one or more hops)
 *  - anything else               -> InvalidTransitionError (a real conflict: alert, do not swallow)
 */
export function planTransition(
  type: number,
  current: number | null,
  target: number,
  journalState: number,
  journalTransactionId: number,
): TransitionPlan {
  if (current === target) return { kind: 'noop', reason: 'duplicate' };

  const currentRank = current === null ? undefined : HAPPY_RANK[current];
  const targetRank = HAPPY_RANK[target];

  if (currentRank !== undefined && targetRank !== undefined && targetRank < currentRank) return { kind: 'noop', reason: 'stale' };

  const invalid = () => new InvalidTransitionError(journalTransactionId, current, target);

  if (journalState !== J.ACTIVE) throw invalid();

  const direct = findEdge(type, current, target);
  if (direct) return { kind: 'apply', hops: [direct] };

  if (FAILURE_STATES.has(target)) throw invalid();

  // fast-forward through skippable chain-observed states
  const hops: TransitionEdge[] = [];
  let cursor = current;
  for (let guard = 0; guard < 8; guard++) {
    const step = TRANSITION_EDGES.find(
      (edge) => edge.type === type && edge.from === cursor && !FAILURE_STATES.has(edge.to) && (edge.to === target || SKIPPABLE_STATES.has(edge.to)),
    );
    if (!step) throw invalid();
    hops.push(step);
    if (step.to === target) return { kind: 'apply', hops };
    cursor = step.to;
  }
  throw invalid();
}
