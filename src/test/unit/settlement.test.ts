import * as assert from 'node:assert/strict';

import { ConservationError } from '../../common/errors';
import { BOOK_POSTING_PURPOSE, TRANSACTION_STATE } from '../../constants';
import { custodyBook, externalBook } from '../../helpers';
import { assertSettlementBalanced } from '../../ledger/settlement';
import type { Holding, LegItem } from '../../types';

const S = TRANSACTION_STATE;
const item = (accountId: number, assetTypeId: number, assetTicker: string): LegItem => ({ clientId: 1, accountId, assetTypeId, walletTypeId: 1, assetId: assetTypeId, assetTicker });
const USDT_SENDER = item(1, 1, 'USDT');
const ETH_PAYER = item(3, 2, 'ETH');
const USDT_RECIPIENT_A = item(2, 1, 'USDT');
const USDT_RECIPIENT_B = item(4, 1, 'USDT');

const amount = (ref: Holding['ref'], who: LegItem, value: bigint): Holding => ({ ref, item: who, purpose: BOOK_POSTING_PURPOSE.AMOUNT, amount: value });

const senderAtConfirming = (value: bigint): Holding[] => [amount(custodyBook(S.CONFIRMING.id), USDT_SENDER, value), amount(custodyBook(S.CONFIRMED.id), USDT_SENDER, -value)];
const senderSettled = (value: bigint): Holding[] => [amount(externalBook(), USDT_SENDER, value), amount(custodyBook(S.CONFIRMED.id), USDT_SENDER, -value)];
const recipientCredited = (who: LegItem, value: bigint, state: number = S.CONFIRMING.id): Holding[] => [amount(custodyBook(state), who, value), amount(externalBook(), who, -value)];
const external = (assetTicker: string, quantity: string) => ({ assetTicker, quantity });

describe('assertSettlementBalanced', () => {
  it('balances an internal withdraw to two internal recipients', () => {
    assert.doesNotThrow(() =>
      assertSettlementBalanced(senderAtConfirming(100n), [...recipientCredited(USDT_RECIPIENT_A, 60n), ...recipientCredited(USDT_RECIPIENT_B, 40n)], [], 'event'),
    );
  });

  it('balances a withdraw split between internal and external recipients', () => {
    assert.doesNotThrow(() => assertSettlementBalanced(senderAtConfirming(100n), recipientCredited(USDT_RECIPIENT_A, 60n), [external('USDT', '40')], 'event'));
  });

  it('balances a withdraw to external addresses only', () => {
    assert.doesNotThrow(() => assertSettlementBalanced(senderAtConfirming(100n), [], [external('USDT', '60'), external('USDT', '40')], 'event'));
  });

  it('counts the sender amount the same way once it has left the platform', () => {
    assert.doesNotThrow(() => assertSettlementBalanced(senderSettled(100n), recipientCredited(USDT_RECIPIENT_A, 100n, S.CONFIRMED.id), [], 'event'));
  });

  it('refuses recipients that receive less or more than the senders gave up', () => {
    assert.throws(() => assertSettlementBalanced(senderAtConfirming(100n), recipientCredited(USDT_RECIPIENT_A, 60n), [external('USDT', '39')], 'event'), ConservationError);
    assert.throws(() => assertSettlementBalanced(senderAtConfirming(100n), recipientCredited(USDT_RECIPIENT_A, 60n), [external('USDT', '41')], 'event'), ConservationError);
  });

  it('refuses an external recipient of an asset nobody sent', () => {
    assert.throws(() => assertSettlementBalanced(senderAtConfirming(100n), [], [external('BTC', '1')], 'event'), ConservationError);
  });

  it('refuses a credit in an asset nobody sent', () => {
    assert.throws(() => assertSettlementBalanced(senderAtConfirming(100n), recipientCredited(item(2, 9, 'DAI'), 5n), [], 'event'), ConservationError);
  });

  it('does not constrain an asset that only the sender side holds (the fee payer sending ETH)', () => {
    const senders = [...senderAtConfirming(100n), amount(custodyBook(S.CONFIRMING.id), ETH_PAYER, 2n), amount(custodyBook(S.CONFIRMED.id), ETH_PAYER, -2n)];

    assert.doesNotThrow(() => assertSettlementBalanced(senders, recipientCredited(USDT_RECIPIENT_A, 100n), [], 'event'));
  });

  it('ignores the fee holdings of the senders', () => {
    const fee: Holding = { ref: custodyBook(S.CONFIRMING.id), item: ETH_PAYER, purpose: BOOK_POSTING_PURPOSE.FEE, amount: 10n };

    assert.doesNotThrow(() => assertSettlementBalanced([...senderAtConfirming(100n), fee], recipientCredited(USDT_RECIPIENT_A, 100n), [], 'event'));
  });

  it('refuses a ticker that maps to two asset types in one event', () => {
    const senders = [...senderAtConfirming(100n), amount(custodyBook(S.CONFIRMING.id), item(5, 7, 'USDT'), 1n)];

    assert.throws(() => assertSettlementBalanced(senders, [], [external('USDT', '100')], 'event'), ConservationError);
  });
});
