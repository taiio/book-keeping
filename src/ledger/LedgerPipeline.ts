import type { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { TransitionNotReadyError } from '../common/errors';
import { FEE_CONSUMING_STATES, HISTORY_EVENT_TYPE, OUTBOX_EVENT_TYPE, POSTING_TOKEN, TRANSITION_DECISION, TRANSITION_OUTCOME } from '../constants';
import type { TransitionOutcome } from '../constants';
import { bookKeyString, bookParamsForRef, bookPostingIdempotencyToken, negateQuantity } from '../helpers';
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
  TransitionStep,
} from '../types';
import { LedgerStateMachine } from './LedgerStateMachine';
import { applyPlanToHoldings, planTransition } from './transitionPlanner';
import { isExceptionState, journalStateForTarget } from './transitionRules';

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

  async attachTransactionHash(journalTransactionIds: number[], transactionHash: string, tx: Transaction): Promise<void> {
    for (const journalTransactionId of [...journalTransactionIds].sort((a, b) => a - b)) {
      await this.journalTransactionRepository.setTransactionHashOnce(journalTransactionId, transactionHash, tx);
    }
  }

  async processTransition(requests: TransitionRequest[], tx: Transaction): Promise<TransitionResult[]> {
    const locked = await this.lockJournalTransactions(requests, tx);
    const steps: TransitionStep[] = [];
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
    steps: TransitionStep[],
    tx: Transaction,
  ): Promise<TransitionOutcome> {
    const currentStateId = await this.getCurrentStateId(journalTransaction.id, tx);

    const decision = this.stateMachine.evaluate({
      transactionTypeId: journalTransaction.transactionTypeId,
      currentStateId,
      targetStateId: request.targetStateId,
      journalTransactionId: journalTransaction.id,
      journalTransactionState: journalTransaction.journalTransactionState,
    });

    if (decision.kind === TRANSITION_DECISION.DUPLICATE) return TRANSITION_OUTCOME.DUPLICATE;
    if (decision.kind === TRANSITION_DECISION.STALE) return TRANSITION_OUTCOME.STALE;
    if (decision.kind === TRANSITION_DECISION.EARLY) throw new TransitionNotReadyError(journalTransaction.id, currentStateId, request.targetStateId);

    const via = decision.kind === TRANSITION_DECISION.CATCH_UP ? decision.via : [];
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

    return TRANSITION_OUTCOME.APPLIED
  }

  private async writeSteps(steps: TransitionStep[], tx: Transaction): Promise<void> {
    if (steps.length === 0) return;

    const books = await this.resolveBooks(steps, tx);
    const lockedBooks = await this.bookRepository.lockBooksInOrder(
      Array.from(books.values(), (book) => book.id),
      tx,
    );

    for (const step of steps) {
      await this.recordState(step, tx);

      let index: number = POSTING_TOKEN.FIRST_INDEX;

      for (const planned of step.planned) {
        const from = lockedBooks.get(this.bookOf(books, planned.item, planned.from).id)!;
        const to = lockedBooks.get(this.bookOf(books, planned.item, planned.to).id)!;

        await this.postDoubleEntry(step, planned, from, to, index, tx);
        index += POSTING_TOKEN.POSTINGS_PER_ENTRY;
      }
    }
  }

  private async resolveBooks(steps: TransitionStep[], tx: Transaction): Promise<Map<string, Book>> {
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

  private async recordState(step: TransitionStep, tx: Transaction): Promise<void> {
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
      attempt: POSTING_TOKEN.FIRST_ATTEMPT,
      synthetic,
    };

    await this.outboxEventRepository.enqueue(
      { aggregate: journalTransaction.idempotencyToken, eventType: OUTBOX_EVENT_TYPE.STATE_CHANGED, stateId: targetStateId, attempt: POSTING_TOKEN.FIRST_ATTEMPT, payload },
      tx,
    );
  }

  private async postDoubleEntry(step: TransitionStep, planned: PlannedPosting, from: Book, to: Book, firstIndex: number, tx: Transaction): Promise<void> {
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
        attempt: POSTING_TOKEN.FIRST_ATTEMPT,
        index,
      });

    await this.bookPostingRepository.createBookPosting(
      { ...common, bookId: from.id, amount: negateQuantity(planned.amount), idempotencyToken: token(firstIndex), lockedBook: from },
      tx,
    );
    await this.bookPostingRepository.createBookPosting(
      { ...common, bookId: to.id, amount: planned.amount, idempotencyToken: token(firstIndex + POSTING_TOKEN.FIRST_INDEX), lockedBook: to },
      tx,
    );
  }
}
