import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { AmountMismatchError, FeeExceedsEstimationError } from '../../common/errors';
import { TRANSACTION_STATE, TRANSACTION_TYPE } from '../../constants';
import { planTransition } from '../../ledger/transitionPlanner';
import { amountLeg, feeLeg, HAPPY_PATH, netByBook, playWithdraw, withdrawHoldings } from './fixtures';

const S = TRANSACTION_STATE;

const plan = (targetStateId: number, currentStateId: number | null, holdings = withdrawHoldings(currentStateId ?? 0), legs = [amountLeg('1000'), feeLeg('8')], consumedFee?: string) =>
  planTransition({ journalTransactionId: 1, transactionTypeId: TRANSACTION_TYPE.WITHDRAW, currentStateId, targetStateId, legs, holdings, consumedFee });

describe('forward planning', () => {
  it('reserves amount and fee when entering AUTHORIZING', () => {
    const { plans } = playWithdraw([S.AUTHORIZING.id]);

    assert.deepEqual(netByBook(plans), new Map([['1/USDT/5', -1000n], ['1/USDT/1', 1000n], ['2/ETH/5', -10n], ['2/ETH/1', 10n]]));
  });

  it('settles the real fee and returns the unspent estimation at CONFIRMED', () => {
    const planned = plan(S.CONFIRMED.id, S.CONFIRMING.id, withdrawHoldings(S.CONFIRMING.id));
    const fee = planned.filter((posting) => posting.item.accountId === 2);

    assert.deepEqual(
      fee.map((posting) => [posting.to.transactionStateId, posting.amount]),
      [[null, '8'], [S.CONFIRMED.id, '2']],
    );
    assert.equal(planned.find((posting) => posting.item.accountId === 1)!.amount, '1000');
  });

  it('leaves nothing behind after a full happy path: user -1000, fee payer -8, external +1008', () => {
    const { plans } = playWithdraw(HAPPY_PATH);
    const confirmed = plan(S.CONFIRMED.id, S.CONFIRMING.id, withdrawHoldings(S.CONFIRMING.id));
    const net = netByBook([...plans, confirmed]);

    assert.deepEqual(net, new Map([['1/USDT/5', -1000n], ['1/USDT/external', 1000n], ['2/ETH/5', -8n], ['2/ETH/external', 8n]]));
  });

  it('rejects an amount that differs from what is held', () => {
    assert.throws(() => plan(S.AUTHORIZED.id, S.AUTHORIZING.id, withdrawHoldings(S.AUTHORIZING.id), [amountLeg('999'), feeLeg('10')]), AmountMismatchError);
  });

  it('rejects a real fee above the estimation', () => {
    assert.throws(() => plan(S.CONFIRMED.id, S.CONFIRMING.id, withdrawHoldings(S.CONFIRMING.id), [amountLeg('1000'), feeLeg('11')]), FeeExceedsEstimationError);
  });

  it('accepts a lower fee on intermediate steps and keeps moving the whole estimation', () => {
    const planned = plan(S.CONFIRMING.id, S.SENT.id, withdrawHoldings(S.SENT.id), [amountLeg('1000'), feeLeg('8')]);

    assert.equal(planned.find((posting) => posting.item.accountId === 2)!.amount, '10');
  });
});

describe('closing (REJECTED / FAILED)', () => {
  for (const [target, from] of [
    [S.REJECTED.id, S.AUTHORIZING.id],
    [S.REJECTED.id, S.AUTHORIZED.id],
    [S.FAILED.id, S.SENT.id],
  ] as const) {
    it(`state ${from} -> ${target} returns amount and fee to CONFIRMED in one pair each`, () => {
      const planned = plan(target, from, withdrawHoldings(from), []);

      assert.deepEqual(netByBook([planned]), new Map([[`1/USDT/${from}`, -1000n], ['1/USDT/5', 1000n], [`2/ETH/${from}`, -10n], ['2/ETH/5', 10n]]));
      assert.equal(planned.length, 2);
    });
  }

  it('FAILED after mining charges the real fee: user whole, fee payer -8', () => {
    const planned = plan(S.FAILED.id, S.CONFIRMING.id, withdrawHoldings(S.CONFIRMING.id), [], '8');
    const { plans } = playWithdraw(HAPPY_PATH);
    const net = netByBook([...plans, planned]);

    assert.deepEqual(net, new Map([['2/ETH/5', -8n], ['2/ETH/external', 8n]]));
  });

  it('FAILED before mining ignores a reported fee (nothing was spent)', () => {
    const planned = plan(S.FAILED.id, S.SENT.id, withdrawHoldings(S.SENT.id), [], undefined);

    assert.equal(planned.length, 2);
  });

  it('refuses a real fee above the reserved estimation', () => {
    assert.throws(() => plan(S.FAILED.id, S.CONFIRMING.id, withdrawHoldings(S.CONFIRMING.id), [], '11'), FeeExceedsEstimationError);
  });

  it('posts nothing for a journal transaction that never held value', () => {
    assert.deepEqual(plan(S.FAILED.id, null, [], []), []);
  });

  it('is deterministic: same input, same posting order', () => {
    const a = plan(S.REJECTED.id, S.AUTHORIZED.id, withdrawHoldings(S.AUTHORIZED.id), []);
    const b = plan(S.REJECTED.id, S.AUTHORIZED.id, [...withdrawHoldings(S.AUTHORIZED.id)].reverse(), []);

    assert.deepEqual(a, b);
  });
});
