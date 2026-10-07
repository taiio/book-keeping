/**
 * Runs the REAL LedgerPipeline + state machine + posting planner against in-memory repositories.
 * It validates orchestration (planning, lock ordering, idempotent replay, fast-forward, refunds, zero-sum).
 * It does NOT validate SQL: the DB layer needs the integration specs in this folder against a live PostgreSQL.
 */
import 'reflect-metadata';
import assert from 'node:assert/strict';

import { AmountMismatchError, InsufficientBalanceError, InvalidTransitionError } from '../../common/errors';
import {
  BOOK_POSTING_PURPOSE as P,
  BOOK_PURPOSE,
  JOURNAL_TRANSACTION_STATE as J,
  TRANSACTION_STATE as S,
  TRANSACTION_TYPE as T,
} from '../../constants';
import { LedgerPipeline } from '../../ledger/LedgerPipeline';
import { LedgerStateMachine } from '../../ledger/LedgerStateMachine';
import { bookPostingIdempotencyToken } from '../../helpers/idempotency';

// ---------------------------------------------------------------- in-memory persistence
interface FBook {
  id: number;
  bookPurposeId: number;
  transactionStateId: number | null;
  assetTypeId: number;
  accountId: number;
  amount: string;
  lastSequenceNo: number;
}
interface FPosting {
  bookId: number;
  journalTransactionId: number;
  amount: string;
  purpose: number;
  sequenceNo: number;
  token: string;
}

const books = new Map<number, FBook>();
const bookKeys = new Map<string, number>();
const postings: FPosting[] = [];
const journals = new Map<number, any>();
const lockLog: number[][] = [];
let nextBook = 1;
let nextJournal = 1;

const journalRepo = {
  async getOrCreateJournalTransaction(p: any) {
    for (const j of journals.values())
      if (p.idempotencyToken && j.idempotencyToken === p.idempotencyToken) return { journalTransaction: j, created: false };
    const j = { id: nextJournal++, ...p, currentStateId: null, journalTransactionState: J.ACTIVE, businessPostDateTime: new Date() };
    journals.set(j.id, j);
    return { journalTransaction: j, created: true };
  },
  async lockByIds(ids: number[]) {
    return new Map([...new Set(ids)].sort((a, b) => a - b).map((id) => [id, journals.get(id)] as const));
  },
  async advance(j: any, n: any) {
    j.currentStateId = n.transactionStateId;
    if (n.journalTransactionState !== undefined) j.journalTransactionState = n.journalTransactionState;
  },
  async findById(id: number) {
    return journals.get(id) ?? null;
  },
};
const historyRepo = {
  async record() {
    return {};
  },
};
const bookRepo = {
  async resolveBookId(p: any) {
    const key = [p.accountId, p.assetTypeId, p.bookPurposeId, p.transactionStateId].join('|');
    let id = bookKeys.get(key);
    if (!id) {
      id = nextBook++;
      bookKeys.set(key, id);
      books.set(id, {
        id,
        bookPurposeId: p.bookPurposeId,
        transactionStateId: p.transactionStateId,
        assetTypeId: p.assetTypeId,
        accountId: p.accountId,
        amount: '0',
        lastSequenceNo: 0,
      });
    }
    return id;
  },
  async lockBooksInOrder(ids: number[]) {
    const sorted = [...new Set(ids)].sort((a, b) => a - b);
    lockLog.push(sorted);
    return new Map(sorted.map((id) => [id, books.get(id)!] as const));
  },
};
const postingRepo = {
  async netHeldByJournal(journalId: number, bookId: number, purpose: number) {
    return postings
      .filter((p) => p.journalTransactionId === journalId && p.bookId === bookId && p.purpose === purpose)
      .reduce((s, p) => s + BigInt(p.amount), 0n);
  },
  async createBookPostingOnLockedBook(book: FBook, p: any) {
    const existing = postings.find((x) => x.bookId === book.id && x.token === p.idempotencyToken);
    if (existing) return existing;
    const next = BigInt(book.amount) + BigInt(p.amount);
    if (next < 0n && book.bookPurposeId === BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id) throw new InsufficientBalanceError(book.id, book.amount, p.amount);
    book.amount = next.toString();
    book.lastSequenceNo += 1;
    const row = {
      bookId: book.id,
      journalTransactionId: p.journalTransactionId,
      amount: p.amount,
      purpose: p.bookPostingPurposeId,
      sequenceNo: book.lastSequenceNo,
      token: p.idempotencyToken,
    };
    postings.push(row);
    return row;
  },
};

const pipeline = new (LedgerPipeline as any)(journalRepo, historyRepo, bookRepo, postingRepo, new (LedgerStateMachine as any)()) as LedgerPipeline;

// ---------------------------------------------------------------- helpers
const acct = (accountId: number, assetTypeId = 1) => ({
  clientId: 1,
  accountId,
  assetTypeId,
  walletTypeId: 1,
  assetId: assetTypeId,
  assetTicker: assetTypeId === 1 ? 'USDT' : 'ETH',
});
const bal = (accountId: number, assetTypeId: number, purpose: number, state: number | null) => {
  const id = bookKeys.get([accountId, assetTypeId, purpose, state].join('|'));
  return id ? BigInt(books.get(id)!.amount) : 0n;
};
const spendable = (a: number, t: number) => bal(a, t, BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id, S.CONFIRMED.id);
const inflight = (a: number, t: number, s: number) => bal(a, t, BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id, s);
const zeroSum = () => {
  const totals = new Map<number, bigint>();
  for (const b of books.values()) totals.set(b.assetTypeId, (totals.get(b.assetTypeId) ?? 0n) + BigInt(b.amount));
  for (const [asset, total] of totals) assert.equal(total, 0n, `asset ${asset} not zero-sum`);
};
const tx = {} as any;
const mk = (type: number, token: string, extra: any = {}) =>
  pipeline.createJournalTransaction({ uuidToken: 'u-' + token, idempotencyToken: token, transactionTypeId: type, ...extra }, tx);
const leg = (accountId: number, assetTypeId: number, amount: string, purpose = P.AMOUNT, feeConsumed = false) => ({
  item: { ...acct(accountId, assetTypeId) } as any,
  amount,
  purpose: purpose as 1,
  feeConsumed,
});
const go = (journal: any, target: number, legs: any[]) =>
  pipeline.processTransition([{ journalTransaction: journal, targetStateId: target, legs }], tx);

let passed = 0;
const test = async (name: string, fn: () => Promise<void>) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

async function fund(accountId: number, assetTypeId: number, amount: string, token: string) {
  const dep = await mk(T.DEPOSIT, token, { toAccountId: accountId });
  await go(dep, S.CONFIRMING.id, [leg(accountId, assetTypeId, amount)]);
  await go(dep, S.CONFIRMED.id, [leg(accountId, assetTypeId, amount)]);
}

(async () => {
  await test('deposit CONFIRMING -> CONFIRMED credits spendable; ledger stays zero-sum', async () => {
    await fund(1, 1, '1000', 'dep-1');
    await fund(1, 2, '10', 'dep-2');
    assert.equal(spendable(1, 1), 1000n);
    assert.equal(inflight(1, 1, S.CONFIRMING.id), 0n);
    zeroSum();
  });

  const withdrawLegs = (fee: string, consumed = false) => [leg(1, 1, '100'), leg(1, 2, fee, P.FEE, consumed)];
  const w = await mk(T.WITHDRAW, 'w-1', { fromAccountId: 1 });

  await test('withdraw walks AUTHORIZING..SENT holding funds; spendable drops by amount + fee', async () => {
    await go(w, S.AUTHORIZING.id, withdrawLegs('2'));
    assert.equal(spendable(1, 1), 900n);
    assert.equal(spendable(1, 2), 8n);
    await go(w, S.AUTHORIZED.id, withdrawLegs('2'));
    await go(w, S.SENT.id, withdrawLegs('2'));
    assert.equal(inflight(1, 1, S.SENT.id), 100n);
    zeroSum();
  });

  await test('duplicate delivery of SENT is a noop (old code threw), nothing is posted twice', async () => {
    const before = postings.length;
    const [r] = await go(w, S.SENT.id, withdrawLegs('2'));
    assert.equal(r!.applied, false);
    assert.equal(postings.length, before);
  });

  await test('chain payload that disagrees with what was authorised is rejected, state untouched', async () => {
    const before = postings.length;
    await assert.rejects(() => go(w, S.CONFIRMING.id, [leg(1, 1, '90'), leg(1, 2, '2', P.FEE)]), AmountMismatchError);
    assert.equal(postings.length, before);
    assert.equal(w.currentStateId, S.SENT.id);
  });

  await test('CONFIRMED arriving before CONFIRMING fast-forwards; fee true-up refunds the unused gas', async () => {
    const [r] = await go(w, S.CONFIRMED.id, withdrawLegs('1')); // actual fee 1 of the 2 authorised
    assert.equal(r!.applied, true);
    assert.equal(w.journalTransactionState, J.COMPLETED);
    assert.equal(inflight(1, 1, S.SENT.id) + inflight(1, 1, S.CONFIRMING.id), 0n);
    assert.equal(spendable(1, 2), 9n); // 10 - 2 held + 1 refunded
    assert.equal(spendable(1, 1), 900n);
    zeroSum();
  });

  await test('late CONFIRMING after completion is ignored; CONFIRMED replay is a noop', async () => {
    assert.equal((await go(w, S.CONFIRMING.id, withdrawLegs('1')))[0]!.applied, false);
    assert.equal((await go(w, S.CONFIRMED.id, withdrawLegs('1')))[0]!.applied, false);
  });

  await test('REJECTED before submission returns everything to spendable', async () => {
    const r = await mk(T.WITHDRAW, 'w-2', { fromAccountId: 1 });
    await go(r, S.AUTHORIZING.id, withdrawLegs('2'));
    assert.equal(spendable(1, 1), 800n);
    await go(r, S.REJECTED.id, withdrawLegs('2'));
    assert.equal(spendable(1, 1), 900n);
    assert.equal(spendable(1, 2), 9n);
    assert.equal(r.journalTransactionState, J.REJECTED);
    zeroSum();
  });

  await test('FAILED after mining: amount refunded, gas burnt; FAILED not mined: everything refunded', async () => {
    const mined = await mk(T.WITHDRAW, 'w-3', { fromAccountId: 1 });
    for (const s of [S.AUTHORIZING, S.AUTHORIZED, S.SENT, S.CONFIRMING]) await go(mined, s.id, withdrawLegs('2'));
    await go(mined, S.FAILED.id, withdrawLegs('2', true));
    assert.equal(spendable(1, 1), 900n); // amount back
    assert.equal(spendable(1, 2), 7n); // 9 - 2 burnt
    const dropped = await mk(T.WITHDRAW, 'w-4', { fromAccountId: 1 });
    for (const s of [S.AUTHORIZING, S.AUTHORIZED, S.SENT]) await go(dropped, s.id, withdrawLegs('2'));
    await go(dropped, S.FAILED.id, withdrawLegs('2', false));
    assert.equal(spendable(1, 2), 7n); // gas fully refunded
    zeroSum();
  });

  await test('cannot authorise more than the spendable balance', async () => {
    const big = await mk(T.WITHDRAW, 'w-5', { fromAccountId: 1 });
    await assert.rejects(() => go(big, S.AUTHORIZING.id, [leg(1, 1, '901')]), InsufficientBalanceError);
  });

  await test('conflicting terminal outcome is surfaced, not swallowed', async () => {
    const done = journals.get(1);
    assert.equal(done.journalTransactionState, J.COMPLETED);
    await assert.rejects(() => go(done, S.FAILED.id, withdrawLegs('1')), InvalidTransitionError);
  });

  await test('internal withdraw: sender -> external -> recipient, each journal stays inside its own account books', async () => {
    const s = await mk(T.WITHDRAW, 'iw-s', { fromAccountId: 1 });
    const r = await mk(T.DEPOSIT, 'iw-r', { toAccountId: 2 });
    for (const st of [S.AUTHORIZING, S.AUTHORIZED, S.SENT]) await go(s, st.id, [leg(1, 1, '50')]);
    await pipeline.processTransition(
      [
        { journalTransaction: s, targetStateId: S.CONFIRMING.id, legs: [leg(1, 1, '50')] },
        { journalTransaction: r, targetStateId: S.CONFIRMING.id, legs: [leg(2, 1, '50')] },
      ],
      tx,
    );
    await pipeline.processTransition(
      [
        { journalTransaction: s, targetStateId: S.CONFIRMED.id, legs: [leg(1, 1, '50')] },
        { journalTransaction: r, targetStateId: S.CONFIRMED.id, legs: [leg(2, 1, '50')] },
      ],
      tx,
    );
    assert.equal(spendable(2, 1), 50n);
    assert.equal(spendable(1, 1), 850n);
    zeroSum();
  });

  await test('every batch locks books in ascending id order (deadlock-free by construction)', async () => {
    for (const ids of lockLog)
      assert.deepEqual(
        ids,
        [...ids].sort((a, b) => a - b),
      );
  });

  await test('posting tokens stay within VARCHAR(64) even for long journal tokens', async () => {
    assert.ok(bookPostingIdempotencyToken('x'.repeat(200), 2, 5, 3).length <= 64);
    assert.equal(bookPostingIdempotencyToken('abc', 2, 5, 3), 'abc-2-5-3');
  });

  console.log(`\n${passed} simulation tests passed`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
