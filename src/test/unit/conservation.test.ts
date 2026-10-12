import * as assert from 'node:assert/strict';

import { ConservationError } from '../../common/errors';
import { TRANSACTION_STATE, TRANSACTION_TYPE } from '../../constants';
import type { Withdraw } from '../../types';
import { validateWithdraw } from '../../validation';

const UUID = '0b6f2c1e-8a44-4d1b-9c55-3a1d7e9f20c2';
const SENDER_TOKEN = '1c7a3d2f-9b55-4e2c-8d66-4b2e8f0a31d3';
const FEE_TOKEN = '2d8b4e3a-0c66-4f3d-9e77-5c3f9a1b42e4';
const RECIPIENT_TOKEN_A = '3e9c5f4b-1d77-4a4e-8f88-6d4a0b2c53f5';
const RECIPIENT_TOKEN_B = '4fad6a5c-2e88-4b5f-9a99-7e5b1c3d6406';
const identity = (accountId: number) => ({ clientId: 1, accountId, assetId: 1, assetTypeId: 1, walletTypeId: 1 });

const withdraw = (senderQuantity: string, recipientQuantities: string[], transactionStateId: number = TRANSACTION_STATE.AUTHORIZING.id): Withdraw => ({
  type: TRANSACTION_TYPE.WITHDRAW,
  uuidToken: UUID,
  transactionStateId,
  sender: [{ idempotencyToken: SENDER_TOKEN, assetTicker: 'USDT', quantity: senderQuantity, account: identity(1) }],
  recipient: recipientQuantities.map((quantity, index) => ({
    idempotencyToken: index === 0 ? RECIPIENT_TOKEN_A : RECIPIENT_TOKEN_B,
    assetTicker: 'USDT',
    quantity,
    address: `address-${index}`,
  })),
  fee: { idempotencyToken: FEE_TOKEN, assetTicker: 'ETH', quantity: '1', account: identity(2) },
});

describe('withdraw conservation', () => {
  it('accepts senders and recipients that add up per asset', () => {
    assert.doesNotThrow(() => validateWithdraw(withdraw('100', ['50', '50'])));
  });

  it('rejects recipients that receive more or less than the senders sent', () => {
    assert.throws(() => validateWithdraw(withdraw('100', ['50', '49'])), ConservationError);
    assert.throws(() => validateWithdraw(withdraw('100', ['60', '50'])), ConservationError);
  });

  it('does not block a closing message with the amounts of the original request', () => {
    assert.doesNotThrow(() => validateWithdraw(withdraw('100', ['50', '49'], TRANSACTION_STATE.REJECTED.id)));
    assert.doesNotThrow(() => validateWithdraw(withdraw('100', ['50', '49'], TRANSACTION_STATE.FAILED.id)));
  });

  it('ignores an asset that only appears on the sender side (value spent on the network)', () => {
    const payload = withdraw('100', ['100']);

    payload.sender.push({ idempotencyToken: FEE_TOKEN, assetTicker: 'ETH', quantity: '2', account: identity(2) });

    assert.doesNotThrow(() => validateWithdraw(payload));
  });
});
