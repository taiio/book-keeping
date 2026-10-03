import { UnsupportedOperationError, ValidationError } from '../common/errors';
import { SUPPORTED_SYSTEM_STATE_IDS, TRANSACTION_TYPE } from '../constants';
import type { Withdraw } from '../types';
import { assertPositiveQuantity, assertPresent, assertUuid } from './common';

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

  assertFeeTokenOwnership(withdraw);

  for (const recipient of withdraw.recipient) {
    assertUuid(recipient.idempotencyToken, 'recipient.idempotencyToken');
  }
}

function assertFeeTokenOwnership(withdraw: Withdraw): void {
  for (const sender of withdraw.sender) {
    if (sender.idempotencyToken === withdraw.fee.idempotencyToken && sender.account?.accountId !== withdraw.fee.account.accountId) {
      throw new ValidationError(`Sender and fee share idempotencyToken ${sender.idempotencyToken} but belong to different accounts`);
    }
  }
}
