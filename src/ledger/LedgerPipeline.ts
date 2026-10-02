import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { TransitionNotReadyError } from '../common/errors';
import { HISTORY_EVENT_TYPE, OUTBOX_EVENT_TYPE } from '../constants';
import { bookKeyString, bookParamsForRef, bookPostingIdempotencyToken, DEFAULT_ATTEMPT, negateQuantity } from '../helpers';
import type { Book, JournalTransaction } from '../models';
import { BookRepository } from '../repositories/BookRepository';
import { BookPostingRepository } from '../repositories/BookPostingRepository';
import { JournalTransactionHistoryRepository } from '../repositories/JournalTransactionHistoryRepository';
import { JournalTransactionRepository } from '../repositories/JournalTransactionRepository';
import { OutboxEventRepository } from '../repositories/OutboxEventRepository';
import type {
  BookRef,
  GetOrCreateJournalTransactionParams,
  LegItem,
  PlannedPosting,
  StateChangedPayload,
  TransitionRequest,
  TransitionResult,
} from '../types';
import { LedgerStateMachine } from './LedgerStateMachine';
import { applyPlanToHoldings, planTransition } from './transitionPlanner';
import { FEE_CONSUMING_STATES, isExceptionState, journalStateForTarget } from './transitions';

/** One state change to write: the journal transaction, the state it reaches and the postings that go with it. */
interface Step {
  journalTransaction: JournalTransaction;
  targetStateId: number;
  synthetic: boolean;
  planned: PlannedPosting[];
}

@singleton()
@autoInjectable()
export class LedgerPipeline {
  private readonly journalTransactionRepository: JournalTransactionRepository;
  private readonly journalTransactionHistoryRepository: JournalTransactionHistoryRepository;
  private readonly bookRepository: BookRepository;
  private readonly bookPostingRepository: BookPostingRepository;
  private readonly stateMachine: LedgerStateMachine;
  private readonly outboxEventRepository: OutboxEventRepository;

  constructor(
    journalTransactionRepository?: JournalTransactionRepository,
    journalTransactionHistoryRepository?: JournalTransactionHistoryRepository,
    bookRepository?: BookRepository,
    bookPostingRepository?: BookPostingRepository,
    stateMachine?: LedgerStateMachine,
    outboxEventRepository?: OutboxEventRepository,
  ) {
    this.journalTransactionRepository = journalTransactionRepository!;
    this.journalTransactionHistoryRepository = journalTransactionHistoryRepository!;
    this.bookRepository = bookRepository!;
    this.bookPostingRepository = bookPostingRepository!;
    this.stateMachine = stateMachine!;
    this.outboxEventRepository = outboxEventRepository!;
  }

  async createJournalTransaction(params: GetOrCreateJournalTransactionParams, tx: Transaction): Promise<JournalTransaction> {
    const { journalTransaction } = await this.journalTransactionRepository.getOrCreateJournalTransaction(
      { businessPostDateTime: new Date(), ...params },
      tx,
    );
    return journalTransaction;
  }

  findByUuidToken(uuidToken: string, tx: Transaction): Promise<JournalTransaction[]> {
    return this.journalTransactionRepository.findAllByUuidToken(uuidToken, tx);
  }

  findByTransactionHash(transactionHash: string, tx: Transaction): Promise<JournalTransaction[]> {
    return this.journalTransactionRepository.findAllByTransactionHash(transactionHash, tx);
  }

  findByIdempotencyTokens(idempotencyTokens: string[], tx: Transaction): Promise<JournalTransaction[]> {
    return this.journalTransactionRepository.findAllByIdempotencyTokens(idempotencyTokens, tx);
  }

  async getCurrentStateId(journalTransactionId: number, tx: Transaction): Promise<number | null> {
    const latest = await this.journalTransactionHistoryRepository.findLatest(journalTransactionId, tx);
    return latest?.transactionStateId ?? null;
  }

  /** Records the hash on every journal transaction of the blockchain transaction. Write-once per journal transaction. */
  async attachTransactionHash(journalTransactionIds: number[], transactionHash: string, tx: Transaction): Promise<void> {
    for (const journalTransactionId of [...journalTransactionIds].sort((a, b) => a - b)) {
      await this.journalTransactionRepository.setTransactionHashOnce(journalTransactionId, transactionHash, tx);
    }
  }

  /**
   * Applies a batch of state changes atomically (the caller owns the DB transaction):
   *  1. lock the journal transactions (ascending id) and decide what each request means;
   *  2. plan the postings (pure);
   *  3. resolve and lock every book of the batch once, in ascending id order, so concurrent batches cannot deadlock;
   *  4. write state, history and postings.
   */
  async processTransition(requests: TransitionRequest[], tx: Transaction): Promise<TransitionResult[]> {
    const locked = await this.lockJournalTransactions(requests, tx);
    const steps: Step[] = [];
    const results: TransitionResult[] = [];

    for (const request of requests) {
      const journalTransaction = locked.get(request.journalTransaction.id)!;
      const outcome = await this.planRequest(request, journalTransaction, steps, tx);

      results.push({ journalTransactionId: journalTransaction.id, outcome });
    }

    await this.writeSteps(steps, tx);

    return results;
  }

  private async lockJournalTransactions(requests: TransitionRequest[], tx: Transaction): Promise<Map<number, JournalTransaction>> {
    const ids = requests.map((request) => request.journalTransaction.id);

    if (new Set(ids).size !== ids.length) throw new Error('A journal transaction may appear only once per batch');

    const locked = new Map<number, JournalTransaction>();

    for (const id of [...ids].sort((a, b) => a - b)) {
      locked.set(id, await this.journalTransactionRepository.lockById(id, tx));
    }

    return locked;
  }

  private async planRequest(
    request: TransitionRequest,
    journalTransaction: JournalTransaction,
    steps: Step[],
    tx: Transaction,
  ): Promise<TransitionResult['outcome']> {
    const currentStateId = await this.getCurrentStateId(journalTransaction.id, tx);

    const decision = this.stateMachine.evaluate({
      transactionTypeId: journalTransaction.transactionTypeId,
      currentStateId,
      targetStateId: request.targetStateId,
      journalTransactionId: journalTransaction.id,
      journalTransactionState: journalTransaction.journalTransactionState,
    });

    if (decision.kind === 'DUPLICATE') return 'DUPLICATE';
    if (decision.kind === 'STALE') return 'STALE';
    if (decision.kind === 'EARLY') throw new TransitionNotReadyError(journalTransaction.id, currentStateId, request.targetStateId);

    const via = decision.kind === 'CATCH_UP' ? decision.via : [];
    let holdings = await this.bookPostingRepository.findHoldings(journalTransaction.id, tx);
    let stateId = currentStateId;

    for (const targetStateId of [...via, request.targetStateId]) {
      const planned = planTransition({
        journalTransactionId: journalTransaction.id,
        transactionTypeId: journalTransaction.transactionTypeId,
        currentStateId: stateId,
        targetStateId,
        legs: request.legs,
        holdings,
        consumedFee: isExceptionState(targetStateId) && stateId !== null && FEE_CONSUMING_STATES.has(stateId) ? request.consumedFee : undefined,
      });

      steps.push({ journalTransaction, targetStateId, synthetic: targetStateId !== request.targetStateId, planned });

      holdings = applyPlanToHoldings(holdings, planned);
      stateId = targetStateId;
    }

    return 'APPLIED';
  }

  private async writeSteps(steps: Step[], tx: Transaction): Promise<void> {
    if (steps.length === 0) return;

    const books = await this.resolveBooks(steps, tx);
    const lockedBooks = await this.bookRepository.lockBooksInOrder(
      Array.from(books.values(), (book) => book.id),
      tx,
    );

    for (const step of steps) {
      await this.recordState(step, tx);

      let index = 1;

      for (const planned of step.planned) {
        const from = lockedBooks.get(this.bookOf(books, planned.item, planned.from).id)!;
        const to = lockedBooks.get(this.bookOf(books, planned.item, planned.to).id)!;

        await this.postDoubleEntry(step, planned, from, to, index, tx);
        index += 2;
      }
    }
  }

  private async resolveBooks(steps: Step[], tx: Transaction): Promise<Map<string, Book>> {
    const books = new Map<string, Book>();

    for (const step of steps) {
      for (const planned of step.planned) {
        for (const ref of [planned.from, planned.to]) {
          const params = bookParamsForRef(planned.item, ref);
          const key = bookKeyString(params);

          if (!books.has(key)) books.set(key, (await this.bookRepository.getOrCreateBook(params, tx)).book);
        }
      }
    }

    return books;
  }

  private bookOf(books: Map<string, Book>, item: LegItem, ref: BookRef): Book {
    return books.get(bookKeyString(bookParamsForRef(item, ref)))!;
  }

  private async recordState(step: Step, tx: Transaction): Promise<void> {
    const { journalTransaction, targetStateId, synthetic } = step;
    const journalState = journalStateForTarget(targetStateId);

    if (journalState !== null) await this.journalTransactionRepository.setJournalState(journalTransaction, journalState, tx);

    await this.journalTransactionHistoryRepository.record(
      {
        journalTransaction,
        historyTransactionTypeId: synthetic ? HISTORY_EVENT_TYPE.STATE_CAUGHT_UP : HISTORY_EVENT_TYPE.STATE_ADVANCED,
        transactionStateId: targetStateId,
      },
      tx,
    );

    const payload: StateChangedPayload = {
      journalTransactionId: journalTransaction.id,
      idempotencyToken: journalTransaction.idempotencyToken,
      uuidToken: journalTransaction.uuidToken,
      transactionTypeId: journalTransaction.transactionTypeId,
      transactionStateId: targetStateId,
      journalTransactionState: journalTransaction.journalTransactionState,
      transactionHash: journalTransaction.transactionHash,
      attempt: DEFAULT_ATTEMPT,
      synthetic,
    };

    await this.outboxEventRepository.enqueue(
      { aggregate: journalTransaction.idempotencyToken, eventType: OUTBOX_EVENT_TYPE.STATE_CHANGED, stateId: targetStateId, attempt: DEFAULT_ATTEMPT, payload },
      tx,
    );
  }

  private async postDoubleEntry(step: Step, planned: PlannedPosting, from: Book, to: Book, firstIndex: number, tx: Transaction): Promise<void> {
    const { journalTransaction, targetStateId } = step;

    const common = {
      journalTransactionId: journalTransaction.id,
      assetTypeId: from.assetTypeId,
      bookPostingPurposeId: planned.purpose,
      businessPostDateTime: journalTransaction.businessPostDateTime ?? new Date(),
    };

    const token = (index: number) =>
      bookPostingIdempotencyToken({
        journalIdempotencyToken: journalTransaction.idempotencyToken,
        transactionTypeId: journalTransaction.transactionTypeId,
        transactionStateId: targetStateId,
        attempt: DEFAULT_ATTEMPT,
        index,
      });

    await this.bookPostingRepository.createBookPosting(
      { ...common, bookId: from.id, amount: negateQuantity(planned.amount), idempotencyToken: token(firstIndex), lockedBook: from },
      tx,
    );
    await this.bookPostingRepository.createBookPosting(
      { ...common, bookId: to.id, amount: planned.amount, idempotencyToken: token(firstIndex + 1), lockedBook: to },
      tx,
    );
  }
}
