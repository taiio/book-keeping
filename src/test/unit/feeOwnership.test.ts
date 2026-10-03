import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ValidationError } from '../../common/errors';
import { TRANSACTION_STATE, TRANSACTION_TYPE } from '../../constants';
import { isFeePaidBy } from '../../helpers';
import type { Withdraw } from '../../types';
import { validateWithdraw } from '../../validation';
import { randomUUID } from 'node:crypto';

const TOKEN_A = randomUUID();
const TOKEN_B = randomUUID();
const identity = (accountId: number) => ({ clientId: 1, accountId, assetId: 1, assetTypeId: 1, walletTypeId: 1 });

const withdraw = (senderAccount: number, feeAccount: number, senderToken = TOKEN_A, feeToken = TOKEN_A): Withdraw => ({
  type: TRANSACTION_TYPE.WITHDRAW,
  uuidToken: randomUUID(),
  transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
  sender: [{ idempotencyToken: senderToken, assetTicker: 'USDT', quantity: '10', account: identity(senderAccount) }],
  recipient: [{ idempotencyToken: TOKEN_B.replace('1c7a', '3e9c'), assetTicker: 'USDT', quantity: '10', address: 'x' }],
  fee: { idempotencyToken: feeToken, assetTicker: 'ETH', quantity: '1', account: identity(feeAccount) },
});

describe('isFeePaidBy', () => {
  it('needs the same token and the same paying account', () => {
    const fee = { idempotencyToken: TOKEN_A, account: { accountId: 1 } };

    assert.equal(isFeePaidBy(fee, { idempotencyToken: TOKEN_A, account: { accountId: 1 } }), true);
    assert.equal(isFeePaidBy(fee, { idempotencyToken: TOKEN_A, account: { accountId: 2 } }), false);
    assert.equal(isFeePaidBy(fee, { idempotencyToken: TOKEN_B, account: { accountId: 1 } }), false);
    assert.equal(isFeePaidBy({ idempotencyToken: TOKEN_A }, { idempotencyToken: TOKEN_A }), false);
  });
});

describe('validateWithdraw fee ownership', () => {
  it('accepts a fee in the sender journal transaction (same token, same account)', () => {
    assert.doesNotThrow(() => validateWithdraw(withdraw(1, 1)));
  });

  it('accepts a fee paid by another account under its own token', () => {
    assert.doesNotThrow(() => validateWithdraw(withdraw(1, 2, TOKEN_A, TOKEN_B)));
  });

  it('rejects a shared token between different accounts', () => {
    assert.throws(() => validateWithdraw(withdraw(1, 2)), ValidationError);
  });
});
