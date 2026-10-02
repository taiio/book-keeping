import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ValidationError } from '../../common/errors';
import { bookPostingIdempotencyToken, deterministicUuid, MAX_POSTING_TOKEN_LENGTH } from '../../helpers';
import { isUuid } from '../../validation/common';

const UUID = '0b6f2c1e-8a44-4d1b-9c55-3a1d7e9f20c2';

describe('bookPostingIdempotencyToken', () => {
  it('is {jt}-{type}-{state}-{attempt}-{index}', () => {
    assert.equal(bookPostingIdempotencyToken({ journalIdempotencyToken: UUID, transactionTypeId: 2, transactionStateId: 1, attempt: 1, index: 1 }), `${UUID}-2-1-1-1`);
  });

  it('is deterministic and differs by attempt and index', () => {
    const base = { journalIdempotencyToken: UUID, transactionTypeId: 2, transactionStateId: 91, attempt: 1, index: 1 };

    assert.equal(bookPostingIdempotencyToken(base), bookPostingIdempotencyToken({ ...base }));
    assert.notEqual(bookPostingIdempotencyToken(base), bookPostingIdempotencyToken({ ...base, attempt: 2 }));
    assert.notEqual(bookPostingIdempotencyToken(base), bookPostingIdempotencyToken({ ...base, index: 2 }));
  });

  it('stays within the column size for the largest ids', () => {
    const token = bookPostingIdempotencyToken({ journalIdempotencyToken: UUID, transactionTypeId: 5, transactionStateId: 91, attempt: 99, index: 99 });

    assert.ok(token.length <= MAX_POSTING_TOKEN_LENGTH);
  });

  it('rejects attempt or index below 1 and tokens that do not fit', () => {
    const base = { journalIdempotencyToken: UUID, transactionTypeId: 2, transactionStateId: 1, attempt: 1, index: 1 };

    assert.throws(() => bookPostingIdempotencyToken({ ...base, index: 0 }), ValidationError);
    assert.throws(() => bookPostingIdempotencyToken({ ...base, attempt: 0 }), ValidationError);
    assert.throws(() => bookPostingIdempotencyToken({ ...base, journalIdempotencyToken: 'x'.repeat(60) }), ValidationError);
  });
});

describe('deterministicUuid', () => {
  it('returns the same valid uuid for the same name and a different one otherwise', () => {
    assert.equal(deterministicUuid('0xabc'), deterministicUuid('0xabc'));
    assert.notEqual(deterministicUuid('0xabc'), deterministicUuid('0xabd'));
    assert.ok(isUuid(deterministicUuid('0xabc')));
  });
});
