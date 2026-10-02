import { AmountMismatchError, FeeExceedsEstimationError, InvalidTransitionError } from '../common/errors';
import { BOOK_POSTING_PURPOSE, TRANSACTION_STATE } from '../constants';
import { custodyBook, externalBook, isExternalBook, sameBookRef, sameLegItem } from '../helpers';
import type { Holding, LedgerLeg, PlanInput, PlannedPosting } from '../types';
import { holdingBookAt, LEDGER_MOVEMENTS, originOf } from './ledgerMovements';
import { ENTRY_STATES, isExceptionState } from './transitions';

/**
 * Turns a state change into the double-entry pairs to post. Pure: everything it needs (what the journal
 * transaction already holds, what the event reports) is passed in, so it is unit-testable without a database.
 */
export function planTransition(input: PlanInput): PlannedPosting[] {
  return isExceptionState(input.targetStateId) ? planClosure(input) : planForward(input);
}

/** Applies planned postings to a holdings snapshot (used to plan several consecutive steps in memory). */
export function applyPlanToHoldings(holdings: readonly Holding[], planned: readonly PlannedPosting[]): Holding[] {
  const next = holdings.map((holding) => ({ ...holding }));

  const adjust = (posting: PlannedPosting, side: 'from' | 'to', delta: bigint): void => {
    const ref = posting[side];
    let holding = next.find((item) => sameBookRef(item.ref, ref) && sameLegItem(item.item, posting.item) && item.purpose === posting.purpose);

    if (!holding) {
      holding = { ref, item: posting.item, purpose: posting.purpose, amount: 0n };
      next.push(holding);
    }

    holding.amount += delta;
  };

  for (const posting of planned) {
    adjust(posting, 'from', -BigInt(posting.amount));
    adjust(posting, 'to', BigInt(posting.amount));
  }

  return next.filter((holding) => holding.amount !== 0n);
}

function planForward(input: PlanInput): PlannedPosting[] {
  const { journalTransactionId, transactionTypeId, currentStateId, targetStateId, legs, holdings } = input;

  const movement = LEDGER_MOVEMENTS[transactionTypeId]?.[targetStateId];

  if (!movement) throw new InvalidTransitionError(journalTransactionId, currentStateId, targetStateId);

  const isEntry = ENTRY_STATES[transactionTypeId] === targetStateId;
  const planned: PlannedPosting[] = [];

  for (const leg of legs) {
    const requested = BigInt(leg.amount);

    if (isEntry) {
      planned.push({ item: leg.item, from: movement.from, to: movement.to, amount: leg.amount, purpose: leg.purpose });
      continue;
    }

    const held = holdings.find((holding) => sameBookRef(holding.ref, movement.from) && sameLegItem(holding.item, leg.item) && holding.purpose === leg.purpose);

    const heldAmount = checkAgainstHeld(journalTransactionId, leg, requested, held);

    if (leg.purpose === BOOK_POSTING_PURPOSE.FEE && isExternalBook(movement.to)) {
      planned.push(...settleFee(leg, movement.from, movement.to, heldAmount, requested));
    } else {
      planned.push({ item: leg.item, from: movement.from, to: movement.to, amount: heldAmount.toString(), purpose: leg.purpose });
    }
  }

  return planned;
}

/**
 * The amount reported by an event must agree with what the journal transaction holds:
 *  - AMOUNT must be equal;
 *  - FEE may be lower (the estimation reserved earlier is moved as a whole; the surplus is settled at the end).
 * Returns the amount actually held, which is the amount to move.
 */
function checkAgainstHeld(journalTransactionId: number, leg: LedgerLeg, requested: bigint, held: Holding | undefined): bigint {
  if (!held) throw new AmountMismatchError(journalTransactionId, leg.purpose, 0n, requested);

  if (leg.purpose === BOOK_POSTING_PURPOSE.FEE) {
    if (requested > held.amount) throw new FeeExceedsEstimationError(journalTransactionId, held.amount, requested);

    return held.amount;
  }

  if (requested !== held.amount) throw new AmountMismatchError(journalTransactionId, leg.purpose, held.amount, requested);

  return held.amount;
}

/** Final settlement of a fee: the real fee goes out, the unspent part of the estimation goes back to CONFIRMED. */
function settleFee(leg: LedgerLeg, from: PlannedPosting['from'], to: PlannedPosting['to'], reserved: bigint, real: bigint): PlannedPosting[] {
  const planned: PlannedPosting[] = [];
  const surplus = reserved - real;

  if (real > 0n) planned.push({ item: leg.item, from, to, amount: real.toString(), purpose: leg.purpose });

  if (surplus > 0n) planned.push({ item: leg.item, from, to: custodyBook(TRANSACTION_STATE.CONFIRMED.id), amount: surplus.toString(), purpose: leg.purpose });

  return planned;
}

/**
 * REJECTED / FAILED: pair-reverse what the transaction holds in the book of its current state back to where it
 * started. Derived from the postings themselves, so it needs no per-type table and works for every type that has
 * a forward movement. When a mined transaction fails, the real fee is then charged to the fee payer.
 */
function planClosure(input: PlanInput): PlannedPosting[] {
  const { journalTransactionId, transactionTypeId, currentStateId, holdings, consumedFee } = input;

  const origin = originOf(transactionTypeId);
  const heldIn = currentStateId === null ? undefined : holdingBookAt(transactionTypeId, currentStateId);

  // Nothing was ever posted (e.g. the recipient side of an internal withdraw): only the state changes.
  if (!origin || !heldIn) return [];

  const toReverse = holdings.filter((holding) => sameBookRef(holding.ref, heldIn) && holding.amount > 0n).sort(compareHoldings);

  const planned: PlannedPosting[] = [];

  for (const holding of toReverse) {
    planned.push({ item: holding.item, from: heldIn, to: origin, amount: holding.amount.toString(), purpose: holding.purpose });

    if (holding.purpose !== BOOK_POSTING_PURPOSE.FEE || consumedFee === undefined || isExternalBook(origin)) continue;

    const real = BigInt(consumedFee);

    if (real > holding.amount) throw new FeeExceedsEstimationError(journalTransactionId, holding.amount, real);

    if (real > 0n) planned.push({ item: holding.item, from: origin, to: externalBook(), amount: real.toString(), purpose: holding.purpose });
  }

  return planned;
}

/** Deterministic order: the posting index is part of the idempotency token. */
function compareHoldings(a: Holding, b: Holding): number {
  return a.purpose - b.purpose || a.item.accountId - b.item.accountId || a.item.assetTypeId - b.item.assetTypeId || a.item.walletTypeId - b.item.walletTypeId;
}
