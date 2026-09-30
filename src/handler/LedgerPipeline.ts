import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { InvalidTransitionError, NotFoundError } from '../common/errors';
import { BOOK_PURPOSE, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';
import { custodyBookParams, externalBookParams } from '../helpers/book';
import { bookPostingIdempotencyToken } from '../helpers/idempotency';
import { negateQuantity } from '../helpers/quantity';
import type { BookLegParams, GetOrCreateJournalTransactionParams } from '../interfaces';
import type { LedgerLeg, TransitionRequest, TransitionResult } from '../interfaces/LedgerPipeline';
import { Book, JournalTransaction } from '../models';
import { BookRepository } from '../repositories/Book';
import { BookPostingRepository } from '../repositories/BookPosting';
import { JournalTransactionRepository } from '../repositories/JournalTransaction';
import { JournalTransactionHistoryRepository } from '../repositories/JournalTransactionHistory';
import { LedgerStateMachine } from './LedgerStateMachine';
import { LEDGER_MOVEMENTS, type BookRef } from './ledger-movements';

@singleton()
@autoInjectable()
export class LedgerPipeline {
  private readonly journalTransactionRepository: JournalTransactionRepository;
  private readonly journalTransactionHistoryRepository: JournalTransactionHistoryRepository;
  private readonly bookRepository: BookRepository;
  private readonly bookPostingRepository: BookPostingRepository;
  private readonly stateMachine: LedgerStateMachine;

  constructor(
    journalTransactionRepository?: JournalTransactionRepository,
    journalTransactionHistoryRepository?: JournalTransactionHistoryRepository,
    bookRepository?: BookRepository,
    bookPostingRepository?: BookPostingRepository,
    stateMachine?: LedgerStateMachine,
  ) {
    this.journalTransactionRepository = journalTransactionRepository!;
    this.journalTransactionHistoryRepository = journalTransactionHistoryRepository!;
    this.bookRepository = bookRepository!;
    this.bookPostingRepository = bookPostingRepository!;
    this.stateMachine = stateMachine!;
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

  async getCurrentStateId(journalTransactionId: number, tx: Transaction): Promise<number | null> {
    const latest = await this.journalTransactionHistoryRepository.findLatest(journalTransactionId, tx);
    return latest?.transactionStateId ?? null;
  }

  async attachTransactionHash(journalTransactionIds: number[], transactionHash: string, tx: Transaction): Promise<void> {
    for (const journalTransactionId of journalTransactionIds)
      await this.journalTransactionRepository.updateJournalTransaction({ journalTransactionId, transactionHash }, tx);
  }

  async processTransition(requests: TransitionRequest[], tx: Transaction): Promise<TransitionResult[]> {
    const results: TransitionResult[] = [];

    for (const request of requests) {
      const journalTransaction = request.journalTransaction;
      const currentStateId = await this.getCurrentStateId(journalTransaction.id, tx);

      this.stateMachine.validate(
        journalTransaction.transactionTypeId,
        currentStateId,
        request.targetStateId,
        journalTransaction.id,
        journalTransaction.journalTransactionState,
      );

      const movement = LEDGER_MOVEMENTS[journalTransaction.transactionTypeId]?.[request.targetStateId];

      if (!movement) throw new InvalidTransitionError(journalTransaction.id, currentStateId, request.targetStateId);

      const books = [];

      for (const leg of request.legs) {
        const from = await this.getOrCreateBook(movement.from, leg.item, tx);
        const to = await this.getOrCreateBook(movement.to, leg.item, tx);
        books.push({ leg, from, to });
      }

      await this.bookRepository.lockBooksInOrder(
        books.flatMap((book) => [book.from.id, book.to.id]),
        tx,
      );

      if (request.targetStateId === TRANSACTION_STATE.CONFIRMED.id) {
        await this.journalTransactionRepository.updateJournalTransaction(
          { journalTransactionId: journalTransaction.id, journalTransactionState: JOURNAL_TRANSACTION_STATE.COMPLETED },
          tx,
        );
        journalTransaction.journalTransactionState = JOURNAL_TRANSACTION_STATE.COMPLETED;
      }

      await this.journalTransactionHistoryRepository.record(
        { journalTransaction, historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED, transactionStateId: request.targetStateId },
        tx,
      );

      let index = 1;

      for (const { leg, from, to } of books) {
        await this.postDoubleEntry(journalTransaction, request.targetStateId, leg, from, to, index, tx);
        index += 2;
      }

      results.push({ journalTransactionId: journalTransaction.id, applied: true });
    }

    return results;
  }

  private async postDoubleEntry(
    journalTransaction: JournalTransaction,
    targetStateId: number,
    leg: LedgerLeg,
    from: Book,
    to: Book,
    firstIndex: number,
    tx: Transaction,
  ): Promise<void> {
    const common = {
      journalTransactionId: journalTransaction.id,
      assetTypeId: from.assetTypeId,
      bookPostingPurposeId: leg.purpose,
      businessPostDateTime: journalTransaction.businessPostDateTime ?? new Date(),
    };
    const token = (index: number) =>
      bookPostingIdempotencyToken(journalTransaction.idempotencyToken!, journalTransaction.transactionTypeId!, targetStateId, index);

    await this.bookPostingRepository.createBookPosting(
      { ...common, bookId: from.id, amount: negateQuantity(leg.amount), idempotencyToken: token(firstIndex) },
      tx,
    );
    await this.bookPostingRepository.createBookPosting({ ...common, bookId: to.id, amount: leg.amount, idempotencyToken: token(firstIndex + 1) }, tx);
  }

  private getOrCreateBook(ref: BookRef, item: LedgerLeg['item'], tx: Transaction): Promise<Book> {
    const params: BookLegParams =
      ref.bookPurposeId === BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.id ? externalBookParams(item) : custodyBookParams(item, ref.transactionStateId!);

    return this.bookRepository.getOrCreateBook(params, tx).then(({ book }) => book);
  }
}
