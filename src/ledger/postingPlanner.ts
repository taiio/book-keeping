import { BOOK_POSTING_PURPOSE, TRANSACTION_STATE } from '../constants';
import { AmountMismatchError } from '../common/errors';
import type { LedgerLeg } from '../types/ledger';
import type { BookRef } from '../types/book';
import { custody, isExternalRef, type Movement, type TransitionEdge } from './transitions';

export interface PlannedPosting {
  from: BookRef;
  to: BookRef;
  amount: bigint;
  purpose: number;
}

/**
 * Pure function: turns one leg of one hop into the postings that must be written.
 *
 * `authorized` is what the journal currently holds in the hop's source book for the leg's purpose (null on entry edges,
 * where the value comes from the chain / external book and there is nothing to compare with).
 *
 * Invariants enforced here (they used to be implicit and trusted the chain payload blindly):
 *  - AMOUNT legs must move exactly what was authorised.
 *  - FEE legs may be <= authorised when the fee is finally burnt; the leftover is refunded to the spendable book.
 *    A fee larger than authorised is a mismatch (manual review), never silently absorbed.
 */
export function planLeg(edge: TransitionEdge, leg: LedgerLeg, authorized: bigint | null): PlannedPosting[] {
  if (edge.movement === null) return [];

  const isFee = leg.purpose === BOOK_POSTING_PURPOSE.FEE;
  const movement: Movement = isFee && leg.feeConsumed && edge.consumedFeeMovement ? edge.consumedFeeMovement : edge.movement;
  const postings: PlannedPosting[] = [];

  const burnsFee = isFee && isExternalRef(movement.to);

  // Move exactly what is held (the payload amount is ignored) when that cannot create or destroy value:
  //  - refund edges (REJECTED / FAILED): the held value goes back to its owner; a failed tx may even report fee = 0
  //  - FEE on intermediate hops: the chain only knows the real gas at the end, so until the fee is burnt the whole
  //    authorised fee just travels along; it is trued up (burn actual + refund leftover) on the burning hop below
  const isRefund = authorized !== null && !isExternalRef(movement.to) && movement.to.transactionStateId === TRANSACTION_STATE.CONFIRMED.id;
  if (authorized !== null && (isRefund || (isFee && !burnsFee))) {
    if (authorized <= 0n) throw new AmountMismatchError(`nothing held to move (purpose=${leg.purpose})`);
    return [{ from: movement.from, to: movement.to, amount: authorized, purpose: leg.purpose }];
  }

  if (!/^[1-9]\d*$/.test(leg.amount)) throw new AmountMismatchError(`leg amount must be a positive integer string: ${leg.amount}`);
  const amount = BigInt(leg.amount);

  if (authorized === null) {
    postings.push({ from: movement.from, to: movement.to, amount, purpose: leg.purpose });
    return postings;
  }

  if (authorized <= 0n) throw new AmountMismatchError(`nothing held to move (purpose=${leg.purpose}, authorized=${authorized})`);

  if (burnsFee) {
    if (amount > authorized) throw new AmountMismatchError(`fee ${amount} exceeds authorized ${authorized}`);
    postings.push({ from: movement.from, to: movement.to, amount, purpose: leg.purpose });

    const leftover = authorized - amount;
    if (leftover > 0n) {
      postings.push({ from: movement.from, to: custody(TRANSACTION_STATE.CONFIRMED.id), amount: leftover, purpose: leg.purpose });
    }
    return postings;
  }

  if (amount !== authorized) throw new AmountMismatchError(`amount ${amount} differs from authorized ${authorized} (purpose=${leg.purpose})`);

  postings.push({ from: movement.from, to: movement.to, amount, purpose: leg.purpose });
  return postings;
}
