import { UnsupportedOperationError } from '../common/errors';
import { SUPPORTED_BLOCKCHAIN_STATUS_IDS } from '../constants';
import type { BlockchainMessagePayload } from '../types';
import { assertNonNegativeQuantity, assertPresent, assertUuid } from './common';

export function validateBlockchainMessage(payload: BlockchainMessagePayload): void {
  assertPresent(payload.transactionHash, 'transactionHash');

  if (!SUPPORTED_BLOCKCHAIN_STATUS_IDS.includes(payload.status)) {
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
