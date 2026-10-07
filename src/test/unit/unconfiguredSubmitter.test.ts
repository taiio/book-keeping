import * as assert from 'node:assert/strict';

import { BlockchainSubmitterNotConfiguredError } from '../../common/errors';
import { UnconfiguredBlockchainSubmitter } from '../../messaging/UnconfiguredBlockchainSubmitter';

describe('UnconfiguredBlockchainSubmitter', () => {
  it('refuses to submit and tells the operator what is missing, as an error that can be retried', async () => {
    const error = (await new UnconfiguredBlockchainSubmitter().submit().catch((reason: unknown) => reason)) as BlockchainSubmitterNotConfiguredError;

    assert.ok(error instanceof BlockchainSubmitterNotConfiguredError);
    assert.equal(error.retryable, true);
    assert.match(error.message, /BLOCKCHAIN_SUBMITTER/);
  });
});
