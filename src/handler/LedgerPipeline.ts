import { Transaction as SequelizeTransaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { BOOK_POSTING_PURPOSE, TRANSACTION_STATE } from '../constants';
import { bookPostingIdempotencyToken, collectDebitAndFeeMovements, custodyBookParams, externalBookParams, negateQuantity } from '../helpers';
import {
  ApplyMovementParams,
  BucketMoveParams,
  DepositMovementParams,
  DepositPhase,
  GetOrCreateJournalTransactionParams,
  GetOrCreateJournalTransactionResult,
  LedgerOperationParams,
  LegItem,
  MovementSpec,
  ReserveResult,
  ResolvedBooks,
  TransitionParams,
  UpdateJournalTransactionResult,
} from '../interfaces';
import { Book } from '../models';
import { BookRepository } from '../repositories/Book';
import { BookPostingRepository } from '../repositories/BookPosting';
import { JournalTransactionRepository } from '../repositories/JournalTransaction';

@singleton()
@autoInjectable()
export class LedgerPipeline {
  private readonly bookRepository: BookRepository;
  private readonly bookPostingRepository: BookPostingRepository;
  private readonly journalTransactionRepository: JournalTransactionRepository;

  constructor(
    bookRepository?: BookRepository,
    bookPostingRepository?: BookPostingRepository,
    journalTransactionRepository?: JournalTransactionRepository,
  ) {
    this.bookRepository = bookRepository!;
    this.bookPostingRepository = bookPostingRepository!;
    this.journalTransactionRepository = journalTransactionRepository!;
  }

  async openJournal(params: GetOrCreateJournalTransactionParams, tx: SequelizeTransaction): Promise<GetOrCreateJournalTransactionResult> {
    return this.journalTransactionRepository.getOrCreateJournalTransaction(params, tx);
  }

  async getCurrentTransactionStateId(journalTransactionId: number, tx: SequelizeTransaction): Promise<number | null> {
    return this.journalTransactionRepository.getCurrentTransactionStateId(journalTransactionId, tx);
  }

  async transition(params: TransitionParams, tx: SequelizeTransaction): Promise<UpdateJournalTransactionResult> {
    const { legs, onApplied, ...update } = params;

    const result = await this.journalTransactionRepository.updateJournalTransaction(update, tx);

    if (result.outcome === 'APPLIED' && legs && onApplied && result.previousTransactionStateId != null) {
      const { journalTransaction } = result;
      const operation: BucketMoveParams = {
        journalTransactionId: journalTransaction.id,
        uuidToken: journalTransaction.uuidToken,
        idempotencyToken: journalTransaction.idempotencyToken ?? journalTransaction.uuidToken,
        transactionTypeId: journalTransaction.transactionTypeId ?? 0,
        legs,
        createdBy: update.updatedBy,
        fromStateId: result.previousTransactionStateId,
        toStateId: result.transactionStateId ?? undefined,
      };

      if (onApplied === 'ADVANCE') {
        await this.advance(operation, tx);
      } else if (onApplied === 'SETTLE') {
        await this.settle(operation, tx);
      } else {
        await this.release(operation, tx);
      }
    }

    return result;
  }

  private async resolveAndLockAll(specs: MovementSpec[], tx: SequelizeTransaction): Promise<Map<string, ResolvedBooks>> {
    const idsBySpecKey = new Map<string, { fromId: number; toId: number }>();
    const allIds: number[] = [];

    for (const spec of specs) {
      const { book: fromBook } = await this.bookRepository.getOrCreateBook(spec.fromLeg, tx);
      const { book: toBook } = await this.bookRepository.getOrCreateBook(spec.toLeg, tx);

      idsBySpecKey.set(spec.key, { fromId: fromBook.id, toId: toBook.id });
      allIds.push(fromBook.id, toBook.id);
    }

    const lockedBooks = await this.bookRepository.lockBooksInOrder(allIds, tx);
    const resolved = new Map<string, ResolvedBooks>();

    for (const [key, { fromId, toId }] of idsBySpecKey) {
      resolved.set(key, { fromBook: lockedBooks.get(fromId)!, toBook: lockedBooks.get(toId)! });
    }

    return resolved;
  }

  private async applyMovement(params: ApplyMovementParams, tx: SequelizeTransaction): Promise<void> {
    const { fromBook, toBook, quantity, purposeId, journalTransactionId, createdBy } = params;
    const businessPostDateTime = new Date();

    const post = (book: Book, amount: string, idempotencyToken: string) =>
      this.bookPostingRepository.createBookPosting(
        {
          bookId: book.id,
          journalTransactionId,
          amount,
          assetTypeId: book.assetTypeId,
          bookPostingPurposeId: purposeId,
          businessPostDateTime,
          idempotencyToken,
          createdBy,
        },
        tx,
      );

    await post(fromBook, negateQuantity(quantity), params.debitIdempotencyToken);
    await post(toBook, quantity, params.creditIdempotencyToken);
  }

  private async applyAll(
    specs: MovementSpec[],
    operation: Pick<LedgerOperationParams, 'journalTransactionId' | 'idempotencyToken' | 'transactionTypeId' | 'createdBy'>,
    transactionStateId: number,
    tx: SequelizeTransaction,
    preResolved?: Map<string, ResolvedBooks>,
  ): Promise<void> {
    const resolved = preResolved ?? (await this.resolveAndLockAll(specs, tx));

    let index = await this.bookPostingRepository.countByJournalTransactionId(operation.journalTransactionId, tx);

    for (const spec of specs) {
      const { fromBook, toBook } = resolved.get(spec.key)!;

      index += 1;
      const debitIdempotencyToken = bookPostingIdempotencyToken(operation.idempotencyToken, operation.transactionTypeId, transactionStateId, index);
      index += 1;
      const creditIdempotencyToken = bookPostingIdempotencyToken(operation.idempotencyToken, operation.transactionTypeId, transactionStateId, index);

      await this.applyMovement(
        {
          fromBook,
          toBook,
          quantity: spec.item.quantity,
          purposeId: spec.purposeId,
          journalTransactionId: operation.journalTransactionId,
          debitIdempotencyToken,
          creditIdempotencyToken,
          createdBy: operation.createdBy,
        },
        tx,
      );
    }
  }

  async reserve(params: LedgerOperationParams, tx: SequelizeTransaction): Promise<ReserveResult> {
    const specs = this.buildSpecs(
      collectDebitAndFeeMovements(params.legs),
      TRANSACTION_STATE.CONFIRMED.id,
      TRANSACTION_STATE.AUTHORIZING.id,
      params.createdBy,
    );
    const resolved = await this.resolveAndLockAll(specs, tx);

    const requiredByBookId = new Map<number, bigint>();
    const bookById = new Map<number, Book>();

    for (const spec of specs) {
      const { fromBook } = resolved.get(spec.key)!;

      bookById.set(fromBook.id, fromBook);
      requiredByBookId.set(fromBook.id, (requiredByBookId.get(fromBook.id) ?? 0n) + BigInt(spec.item.quantity));
    }

    const shortfalls: string[] = [];

    for (const [bookId, required] of requiredByBookId) {
      const book = bookById.get(bookId)!;
      const available = BigInt(book.amount);

      if (available < required) {
        shortfalls.push(`bookId=${bookId} assetId=${book.assetId} required=${required} available=${available}`);
      }
    }

    if (shortfalls.length > 0) {
      return { ok: false, shortfalls };
    }

    await this.applyAll(specs, params, TRANSACTION_STATE.AUTHORIZING.id, tx, resolved);

    return { ok: true };
  }

  async advance(params: BucketMoveParams, tx: SequelizeTransaction): Promise<void> {
    if (params.toStateId == null) {
      throw new Error('advance() requires toStateId.');
    }

    const specs = this.buildSpecs(collectDebitAndFeeMovements(params.legs), params.fromStateId, params.toStateId, params.createdBy);

    await this.applyAll(specs, params, params.toStateId, tx);
  }

  async release(params: BucketMoveParams, tx: SequelizeTransaction): Promise<void> {
    const specs = this.buildSpecs(collectDebitAndFeeMovements(params.legs), params.fromStateId, TRANSACTION_STATE.CONFIRMED.id, params.createdBy);

    await this.applyAll(specs, params, params.fromStateId, tx);
  }

  async settle(params: BucketMoveParams, tx: SequelizeTransaction): Promise<void> {
    const fromStateId = params.fromStateId;
    const specs: MovementSpec[] = collectDebitAndFeeMovements(params.legs).map((movement) => ({
      ...movement,
      fromLeg: custodyBookParams(movement.item, fromStateId, params.createdBy),
      toLeg: externalBookParams(movement.item, params.createdBy),
    }));

    params.legs.creditItems.forEach((item, index) => {
      specs.push({
        key: `C${index}`,
        item,
        purposeId: BOOK_POSTING_PURPOSE.AMOUNT,
        fromLeg: externalBookParams(item, params.createdBy),
        toLeg: custodyBookParams(item, TRANSACTION_STATE.CONFIRMED.id, params.createdBy),
      });
    });

    await this.applyAll(specs, params, TRANSACTION_STATE.CONFIRMED.id, tx);
  }

  async postDeposit(phase: DepositPhase, params: DepositMovementParams, tx: SequelizeTransaction): Promise<void> {
    const { matchedCustodyBook: available } = params;

    const item: LegItem = {
      assetId: available.assetId,
      assetTicker: available.assetTicker,
      quantity: params.quantity,
      clientId: available.clientId,
      accountId: available.accountId,
      assetTypeId: available.assetTypeId,
      walletTypeId: available.walletTypeId,
    };

    const { book: confirmingUnlocked } = await this.bookRepository.getOrCreateBook(
      custodyBookParams(item, TRANSACTION_STATE.CONFIRMING.id, params.createdBy),
      tx,
    );
    const { book: externalUnlocked } = await this.bookRepository.getOrCreateBook(externalBookParams(item, params.createdBy), tx);

    const locked = await this.bookRepository.lockBooksInOrder([available.id, confirmingUnlocked.id, externalUnlocked.id], tx);
    const confirming = locked.get(confirmingUnlocked.id)!;
    const external = locked.get(externalUnlocked.id)!;

    const [fromBook, toBook] =
      phase === TRANSACTION_STATE.CONFIRMING.code
        ? [external, confirming]
        : phase === TRANSACTION_STATE.CONFIRMED.code
          ? [confirming, locked.get(available.id)!]
          : [confirming, external];

    const transactionStateId = phase === TRANSACTION_STATE.CONFIRMED.code ? TRANSACTION_STATE.CONFIRMED.id : TRANSACTION_STATE.CONFIRMING.id;
    const index = (await this.bookPostingRepository.countByJournalTransactionId(params.journalTransactionId, tx)) + 1;

    await this.applyMovement(
      {
        fromBook,
        toBook,
        quantity: params.quantity,
        purposeId: BOOK_POSTING_PURPOSE.AMOUNT,
        journalTransactionId: params.journalTransactionId,
        debitIdempotencyToken: bookPostingIdempotencyToken(params.idempotencyToken, params.transactionTypeId, transactionStateId, index),
        creditIdempotencyToken: bookPostingIdempotencyToken(params.idempotencyToken, params.transactionTypeId, transactionStateId, index + 1),
        createdBy: params.createdBy,
      },
      tx,
    );
  }

  private buildSpecs(
    movements: ReturnType<typeof collectDebitAndFeeMovements>,
    fromStateId: number,
    toStateId: number,
    createdBy?: number,
  ): MovementSpec[] {
    return movements.map((movement) => ({
      ...movement,
      fromLeg: custodyBookParams(movement.item, fromStateId, createdBy),
      toLeg: custodyBookParams(movement.item, toStateId, createdBy),
    }));
  }
}
