import * as assert from 'node:assert/strict';

import { ValidationError } from '../../common/errors';
import { TRANSACTION_STATE, TRANSACTION_TYPE } from '../../constants';
import { isFeePaidBy } from '../../helpers';
import type { Withdraw } from '../../types';
import { validateWithdraw } from '../../validation';

const TOKEN_A = '0b6f2c1e-8a44-4d1b-9c55-3a1d7e9f20c2';
const TOKEN_B = '1c7a3d2f-9b55-4e2c-8d66-4b2e8f0a31d3';
const identity = (accountId: number) => ({ clientId: 1, accountId, assetId: 1, assetTypeId: 1, walletTypeId: 1 });

const withdraw = (senderAccount: number, feeAccount: number, senderToken = TOKEN_A, feeToken = TOKEN_A): Withdraw => ({
  type: TRANSACTION_TYPE.WITHDRAW,
  uuidToken: '2d8b4e3a-0c66-4f3d-9e77-5c3f9a1b42e4',
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
