import assert from 'node:assert/strict';

import { BOOK_POSTING_PURPOSE, JOURNAL_TRANSACTION_STATE as J, TRANSACTION_STATE as S, TRANSACTION_TYPE as T } from '../../constants';
import { InvalidTransitionError, AmountMismatchError } from '../../common/errors';
import { planTransition, TRANSITION_EDGES, isExternalRef } from '../../ledger/transitions';
import { planLeg } from '../../ledger/postingPlanner';

let passed = 0;
const test = (name: string, fn: () => void) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const edge = (type: number, from: number | null, to: number) => {
  const e = TRANSITION_EDGES.find((x) => x.type === type && x.from === from && x.to === to);
  assert.ok(e, `edge ${type}:${from}->${to}`);
  return e;
};

// ---- state machine -------------------------------------------------------------------------------------------
test('withdraw happy path is walkable edge by edge', () => {
  const order = [null, S.AUTHORIZING.id, S.AUTHORIZED.id, S.SENT.id, S.CONFIRMING.id, S.CONFIRMED.id];
  for (let i = 1; i < order.length; i++) {
    const plan = planTransition(T.WITHDRAW, order[i - 1], order[i]!, J.ACTIVE, 1);
    assert.equal(plan.kind, 'apply');
  }
});

test('duplicate delivery is a noop, not an error (the old code threw InvalidTransitionError)', () => {
  assert.deepEqual(planTransition(T.WITHDRAW, S.SENT.id, S.SENT.id, J.ACTIVE, 1), { kind: 'noop', reason: 'duplicate' });
  assert.deepEqual(planTransition(T.DEPOSIT, S.CONFIRMED.id, S.CONFIRMED.id, J.COMPLETED, 1), { kind: 'noop', reason: 'duplicate' });
});

test('stale (older) happy-path message after completion is a noop', () => {
  assert.deepEqual(planTransition(T.WITHDRAW, S.CONFIRMED.id, S.CONFIRMING.id, J.COMPLETED, 1), { kind: 'noop', reason: 'stale' });
});

test('CONFIRMED before CONFIRMING fast-forwards through CONFIRMING (withdraw SENT and deposit entry)', () => {
  const w = planTransition(T.WITHDRAW, S.SENT.id, S.CONFIRMED.id, J.ACTIVE, 1);
  assert.equal(w.kind === 'apply' && w.hops.map((h) => h.to).join(), [S.CONFIRMING.id, S.CONFIRMED.id].join());
  const d = planTransition(T.DEPOSIT, null, S.CONFIRMED.id, J.ACTIVE, 1);
  assert.equal(d.kind === 'apply' && d.hops.map((h) => h.to).join(), [S.CONFIRMING.id, S.CONFIRMED.id].join());
});

test('authorisation / submission states can NOT be skipped', () => {
  assert.throws(() => planTransition(T.WITHDRAW, null, S.CONFIRMED.id, J.ACTIVE, 1), InvalidTransitionError);
  assert.throws(() => planTransition(T.WITHDRAW, S.AUTHORIZING.id, S.SENT.id, J.ACTIVE, 1), InvalidTransitionError);
});

test('failure edges exist where they should and nowhere else', () => {
  assert.equal(planTransition(T.WITHDRAW, S.AUTHORIZED.id, S.REJECTED.id, J.ACTIVE, 1).kind, 'apply');
  assert.equal(planTransition(T.WITHDRAW, S.CONFIRMING.id, S.FAILED.id, J.ACTIVE, 1).kind, 'apply');
  assert.throws(() => planTransition(T.WITHDRAW, S.SENT.id, S.REJECTED.id, J.ACTIVE, 1), InvalidTransitionError); // already on the wire
  assert.throws(() => planTransition(T.WITHDRAW, S.AUTHORIZING.id, S.FAILED.id, J.ACTIVE, 1), InvalidTransitionError);
});

test('conflicting terminal outcome (FAILED then CONFIRMED) raises instead of being swallowed', () => {
  assert.throws(() => planTransition(T.WITHDRAW, S.FAILED.id, S.CONFIRMED.id, J.FAILED, 1), InvalidTransitionError);
});

test('deposit pre-created by internal withdraw can be voided without postings', () => {
  const plan = planTransition(T.DEPOSIT, null, S.FAILED.id, J.ACTIVE, 1);
  assert.ok(plan.kind === 'apply' && plan.hops[0]!.movement === null);
});

test('every edge moves value between two different books and never out of EXTERNAL on a withdraw', () => {
  for (const e of TRANSITION_EDGES) {
    if (!e.movement) continue;
    assert.notDeepEqual(e.movement.from, e.movement.to);
    if (e.type === T.WITHDRAW) assert.equal(isExternalRef(e.movement.from), false);
  }
});

// ---- posting planner -----------------------------------------------------------------------------------------
const leg = (amount: string, purpose: number, feeConsumed = false) => ({
  item: { clientId: 1, accountId: 1, assetId: 1, assetTypeId: 1, walletTypeId: 1, assetTicker: 'USDT' },
  amount,
  purpose: purpose as 1,
  feeConsumed,
});

test('AMOUNT must equal what was authorised (chain payload is not trusted)', () => {
  const e = edge(T.WITHDRAW, S.SENT.id, S.CONFIRMING.id);
  assert.equal(planLeg(e, leg('100', BOOK_POSTING_PURPOSE.AMOUNT), 100n).length, 1);
  assert.throws(() => planLeg(e, leg('90', BOOK_POSTING_PURPOSE.AMOUNT), 100n), AmountMismatchError);
  assert.throws(() => planLeg(e, leg('110', BOOK_POSTING_PURPOSE.AMOUNT), 100n), AmountMismatchError);
});

test('entry edges take the chain amount as-is', () => {
  const e = edge(T.DEPOSIT, null, S.CONFIRMING.id);
  assert.equal(planLeg(e, leg('1000', BOOK_POSTING_PURPOSE.AMOUNT), null)[0]!.amount, 1000n);
});

test('fee true-up: burn actual, refund leftover to spendable book, total is conserved', () => {
  const e = edge(T.WITHDRAW, S.CONFIRMING.id, S.CONFIRMED.id);
  const posts = planLeg(e, leg('7', BOOK_POSTING_PURPOSE.FEE), 10n);
  assert.equal(posts.length, 2);
  assert.equal(posts[0]!.amount + posts[1]!.amount, 10n);
  assert.equal(isExternalRef(posts[0]!.to), true);
  assert.equal(posts[1]!.to.transactionStateId, S.CONFIRMED.id);
  assert.equal(planLeg(e, leg('10', BOOK_POSTING_PURPOSE.FEE), 10n).length, 1); // exact fee: no refund posting
  assert.throws(() => planLeg(e, leg('11', BOOK_POSTING_PURPOSE.FEE), 10n), AmountMismatchError);
});

test('failed tx: AMOUNT refunded; FEE refunded unless it was really burnt', () => {
  const e = edge(T.WITHDRAW, S.CONFIRMING.id, S.FAILED.id);
  const amount = planLeg(e, leg('100', BOOK_POSTING_PURPOSE.AMOUNT), 100n)[0]!;
  assert.equal(amount.to.transactionStateId, S.CONFIRMED.id);
  const notBurnt = planLeg(e, leg('3', BOOK_POSTING_PURPOSE.FEE, false), 3n)[0]!;
  assert.equal(notBurnt.to.transactionStateId, S.CONFIRMED.id);
  const burnt = planLeg(e, leg('2', BOOK_POSTING_PURPOSE.FEE, true), 3n);
  assert.equal(isExternalRef(burnt[0]!.to), true);
  assert.equal(burnt[1]!.amount, 1n);
});

test('fee on an intermediate hop travels whole, whatever the payload says; AMOUNT is still strict', () => {
  const e = edge(T.WITHDRAW, S.SENT.id, S.CONFIRMING.id);
  assert.equal(planLeg(e, leg('1', BOOK_POSTING_PURPOSE.FEE), 2n)[0]!.amount, 2n);
  assert.throws(() => planLeg(e, leg('1', BOOK_POSTING_PURPOSE.AMOUNT), 2n), AmountMismatchError);
});

test('refund returns exactly what is held, even if the failed tx reports fee = 0', () => {
  const e = edge(T.WITHDRAW, S.SENT.id, S.FAILED.id);
  const posts = planLeg(e, leg('0', BOOK_POSTING_PURPOSE.FEE, false), 5n);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]!.amount, 5n);
  assert.equal(posts[0]!.to.transactionStateId, S.CONFIRMED.id);
  assert.throws(() => planLeg(e, leg('1', BOOK_POSTING_PURPOSE.AMOUNT), 0n), AmountMismatchError); // nothing held
});

test('zero / negative / non-integer amounts are rejected', () => {
  const e = edge(T.DEPOSIT, null, S.CONFIRMING.id);
  for (const bad of ['0', '-5', '1.5', '', 'abc']) assert.throws(() => planLeg(e, leg(bad, BOOK_POSTING_PURPOSE.AMOUNT), null), AmountMismatchError);
});

console.log(`\n${passed} tests passed`);
