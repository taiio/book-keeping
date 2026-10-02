import { UnsupportedOperationError } from '../common/errors';
import { BLOCKCHAIN_TRANSACTION_STATE_ID } from '../constants';
import type { BlockchainMessagePayload } from '../types';
import { assertNonNegativeQuantity, assertPresent, assertUuid } from './common';

const SUPPORTED_STATUSES: readonly number[] = Object.values(BLOCKCHAIN_TRANSACTION_STATE_ID);

export function validateBlockchainMessage(payload: BlockchainMessagePayload): void {
  assertPresent(payload.transactionHash, 'transactionHash');

  if (!SUPPORTED_STATUSES.includes(payload.status)) {
    throw new UnsupportedOperationError(`blockchain status ${payload.status}`);
  }

  for (const recipient of payload.recipients) {
    if (recipient.account) assertUuid(recipient.idempotencyToken, 'recipient.idempotencyToken');
  }

  for (const sender of payload.senders) {
    if (sender.account) assertUuid(sender.idempotencyToken, 'sender.idempotencyToken');
  }

  assertNonNegativeQuantity(payload.networkFee.quantity, 'networkFee.quantity');
}
