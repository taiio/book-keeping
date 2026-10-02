import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InvalidTransitionError } from '../../common/errors';
import { JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../../constants';
import { LedgerStateMachine } from '../../ledger/LedgerStateMachine';

const S = TRANSACTION_STATE;
const machine = new LedgerStateMachine();

const evaluate = (type: number, current: number | null, target: number, journalState: number = JOURNAL_TRANSACTION_STATE.ACTIVE) =>
  machine.evaluate({ transactionTypeId: type, currentStateId: current, targetStateId: target, journalTransactionId: 1, journalTransactionState: journalState });

const W = TRANSACTION_TYPE.WITHDRAW;
const D = TRANSACTION_TYPE.DEPOSIT;

describe('LedgerStateMachine', () => {
  it('applies the next happy-path state', () => {
    assert.equal(evaluate(W, null, S.AUTHORIZING.id).kind, 'APPLY');
    assert.equal(evaluate(W, S.SENT.id, S.CONFIRMING.id).kind, 'APPLY');
    assert.equal(evaluate(D, null, S.CONFIRMING.id).kind, 'APPLY');
  });

  it('treats a repeated state as a duplicate, not an error', () => {
    assert.equal(evaluate(W, S.SENT.id, S.SENT.id).kind, 'DUPLICATE');
    assert.equal(evaluate(W, S.CONFIRMED.id, S.CONFIRMED.id).kind, 'DUPLICATE');
  });

  it('treats a state already passed as stale', () => {
    assert.equal(evaluate(W, S.CONFIRMING.id, S.SENT.id).kind, 'STALE');
  });

  it('parks an event that arrives before its predecessor', () => {
    assert.equal(evaluate(W, S.AUTHORIZING.id, S.SENT.id).kind, 'EARLY');
    assert.equal(evaluate(W, null, S.SENT.id).kind, 'EARLY');
  });

  it('catches up CONFIRMING when CONFIRMED arrives while SENT', () => {
    assert.deepEqual(evaluate(W, S.SENT.id, S.CONFIRMED.id), { kind: 'CATCH_UP', via: [S.CONFIRMING.id] });
  });

  it('allows REJECTED only before SENT and FAILED only from SENT on', () => {
    assert.equal(evaluate(W, S.AUTHORIZING.id, S.REJECTED.id).kind, 'APPLY');
    assert.equal(evaluate(W, S.AUTHORIZED.id, S.REJECTED.id).kind, 'APPLY');
    assert.equal(evaluate(W, S.SENT.id, S.FAILED.id).kind, 'APPLY');
    assert.equal(evaluate(W, S.CONFIRMING.id, S.FAILED.id).kind, 'APPLY');

    assert.throws(() => evaluate(W, S.SENT.id, S.REJECTED.id), InvalidTransitionError);
    assert.equal(evaluate(W, S.AUTHORIZED.id, S.FAILED.id).kind, 'EARLY');
  });

  it('never closes a CONFIRMED transaction', () => {
    assert.throws(() => evaluate(W, S.CONFIRMED.id, S.FAILED.id, JOURNAL_TRANSACTION_STATE.COMPLETED), InvalidTransitionError);
    assert.throws(() => evaluate(W, S.CONFIRMED.id, S.REJECTED.id, JOURNAL_TRANSACTION_STATE.COMPLETED), InvalidTransitionError);
  });

  it('refuses anything after a transaction was closed, but a repeated closing is a duplicate', () => {
    assert.equal(evaluate(W, S.FAILED.id, S.FAILED.id, JOURNAL_TRANSACTION_STATE.FAILED).kind, 'DUPLICATE');
    assert.throws(() => evaluate(W, S.FAILED.id, S.REJECTED.id, JOURNAL_TRANSACTION_STATE.FAILED), InvalidTransitionError);
    assert.throws(() => evaluate(W, S.REJECTED.id, S.AUTHORIZED.id, JOURNAL_TRANSACTION_STATE.REJECTED), InvalidTransitionError);
  });

  it('lets a recipient journal transaction without state be closed with the withdraw', () => {
    assert.equal(evaluate(D, null, S.REJECTED.id).kind, 'APPLY');
    assert.equal(evaluate(D, null, S.FAILED.id).kind, 'APPLY');
    assert.equal(evaluate(D, S.CONFIRMING.id, S.FAILED.id).kind, 'APPLY');
  });
});
