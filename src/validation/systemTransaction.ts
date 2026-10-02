import { UnsupportedOperationError, ValidationError } from '../common/errors';
import { TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';
import type { Withdraw } from '../types';
import { assertPositiveQuantity, assertPresent, assertUuid } from './common';

/** States a system message may drive. REJECTED / FAILED close the transaction. */
export const SUPPORTED_SYSTEM_STATE_IDS: readonly number[] = [
  TRANSACTION_STATE.AUTHORIZING.id,
  TRANSACTION_STATE.AUTHORIZED.id,
  TRANSACTION_STATE.SENT.id,
  TRANSACTION_STATE.REJECTED.id,
  TRANSACTION_STATE.FAILED.id,
];

export function validateWithdraw(withdraw: Withdraw): void {
  if (withdraw.type !== TRANSACTION_TYPE.WITHDRAW) {
    throw new UnsupportedOperationError(`transaction type ${(withdraw as { type: number }).type}`);
  }

  assertUuid(withdraw.uuidToken, 'uuidToken');

  if (!SUPPORTED_SYSTEM_STATE_IDS.includes(withdraw.transactionStateId)) {
    throw new UnsupportedOperationError(`system transaction state ${withdraw.transactionStateId}`);
  }

  if (!withdraw.sender?.length) throw new ValidationError('At least one sender is required');

  assertPresent(withdraw.fee, 'fee');
  assertPresent(withdraw.fee.account, 'fee.account');

  for (const sender of withdraw.sender) {
    if (!sender.account) throw new ValidationError(`Sender must be an internal account: idempotencyToken=${sender.idempotencyToken}`);
  }

  for (const item of [...withdraw.sender, withdraw.fee]) {
    assertUuid(item.idempotencyToken, 'idempotencyToken');
    assertPositiveQuantity(item.quantity, 'quantity');
  }

  for (const recipient of withdraw.recipient ?? []) {
    assertUuid(recipient.idempotencyToken, 'recipient.idempotencyToken');
  }
}
