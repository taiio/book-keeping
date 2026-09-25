import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { Book, JournalTransaction } from '../models';
import { UnitOfWork } from '../common/UnitOfWork';
import { BookRepository, BookPostingRepository, JournalTransactionRepository } from '../repositories';
import { BOOK_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, BOOK_POSTING_PURPOSE } from '../constants';
import { BaseTransactionRequest } from './types';

export type StakeRequest = BaseTransactionRequest;

/**
 * Stake lifecycle (demo nghiệp vụ thứ 3 tái dùng lại đúng các repository của
 * deposit/withdraw, chỉ đổi params):
 *
 *   AUTHORIZING -> AUTHORIZED (đã khoá tài sản để stake) -> CONFIRMED (đã unstake, trả lại client)
 *
 * Books:
 *   1. CLIENT_ASSET_ACCOUNT       (ví client)
 *   2. CUSTODY_CONTROL_ACCOUNT    (nơi giữ tài sản đang stake)
 *
 * AUTHORIZED: CLIENT -amount, CUSTODY +amount   (khoá tài sản)
 * CONFIRMED : CUSTODY -amount, CLIENT +amount   (unstake, trả lại)
 */
@singleton()
@autoInjectable()
export class StakeFlow {
  private readonly unitOfWork: UnitOfWork;
  private readonly journalTransactionRepository: JournalTransactionRepository;
  private readonly bookRepository: BookRepository;
  private readonly bookPostingRepository: BookPostingRepository;

  constructor(
    unitOfWork?: UnitOfWork,
    journalTransactionRepository?: JournalTransactionRepository,
    bookRepository?: BookRepository,
    bookPostingRepository?: BookPostingRepository,
  ) {
    this.unitOfWork = unitOfWork!;
    this.journalTransactionRepository = journalTransactionRepository!;
    this.bookRepository = bookRepository!;
    this.bookPostingRepository = bookPostingRepository!;
  }

  // async create(request: StakeRequest): Promise<JournalTransaction> {
  //   return this.unitOfWork.execute(async (tx) => {
  //     const journalTransaction = await this.journalTransactionRepository.getOrCreateJournalTransaction(
  //       {
  //         idempotencyToken: request.idempotencyToken,
  //         uuidToken: request.uuidToken,
  //         transactionTypeId: TRANSACTION_TYPE.STAKE,
  //         fromAccountId: request.accountId,
  //         toAccountId: null,
  //         transactionHash: request.transactionHash,
  //         createdBy: request.createdBy,
  //         journalTransactionStateId: JOURNAL_TRANSACTION_STATE.ACTIVE,
  //         historyTransactionTypeId: HISTORY_EVENT_TYPE.CREATED,
  //         businessPostDateTime: request.businessPostDateTime,
  //       },
  //       tx,
  //     );

  //     const book = await this.bookRepository.getOrCreateBook(
  //       {
  //         idempotencyToken: `stake:${journalTransaction.id}:client`,
  //         name: `stake:${journalTransaction.id}:client`,
  //         bookPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
  //         transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
  //         clientId: request.clientId,
  //         accountId: request.accountId,
  //         assetId: request.assetId,
  //         assetTypeId: request.assetTypeId,
  //         assetTicker: request.assetTicker,
  //         walletTypeId: request.walletTypeId,
  //         address: request.address,
  //         createdBy: request.createdBy,
  //       },
  //       tx,
  //     );

  //     const book2 = await this.bookRepository.getOrCreateBook(
  //       {
  //         idempotencyToken: `stake:${journalTransaction.id}:custody`,
  //         name: `stake:${journalTransaction.id}:custody`,
  //         bookPurposeId: BOOK_PURPOSE.CUSTODY_CONTROL_ACCOUNT.id,
  //         transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
  //         clientId: null,
  //         accountId: null,
  //         assetId: request.assetId,
  //         assetTypeId: request.assetTypeId,
  //         assetTicker: request.assetTicker,
  //         walletTypeId: request.walletTypeId,
  //         address: request.address,
  //         createdBy: request.createdBy,
  //       },
  //       tx,
  //     );

  //     await this.bookPostingRepository.createBookPosting(
  //       {
  //         bookId: book.id,
  //         journalTransactionId: journalTransaction.id,
  //         amount: `-${request.amount}`,
  //         assetTypeId: request.assetTypeId,
  //         idempotencyToken: `${request.idempotencyToken}:authorized:client`,
  //         historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
  //         createdBy: request.createdBy,
  //         bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
  //         businessPostDateTime: request.businessPostDateTime,
  //       },
  //       tx,
  //     );

  //     await this.bookPostingRepository.createBookPosting(
  //       {
  //         bookId: book2.id,
  //         journalTransactionId: journalTransaction.id,
  //         amount: request.amount,
  //         assetTypeId: request.assetTypeId,
  //         idempotencyToken: `${request.idempotencyToken}:authorized:custody`,
  //         historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
  //         createdBy: request.createdBy,
  //         bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
  //         businessPostDateTime: request.businessPostDateTime,
  //       },
  //       tx,
  //     );

  //     // Đánh dấu journal ở state AUTHORIZED ngay sau khi khoá tài sản xong.
  //     await this.journalTransactionRepository.updateJournalTransaction(
  //       {
  //         journalTransactionId: journalTransaction.id,
  //         targetStateId: TRANSACTION_STATE.AUTHORIZED.id,
  //         historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
  //         updatedBy: request.createdBy,
  //       },
  //       tx,
  //     );

  //     return journalTransaction;
  //   });
  // }

  /** Unstake: trả tài sản đã khoá về lại cho client, đóng journal. */
  // async unstake(journalTransactionId: number, updatedBy?: number | null): Promise<JournalTransaction> {
  //   return this.unitOfWork.execute(async (tx) => {
  //     const journalTransaction = await this.journalTransactionRepository.updateJournalTransaction(
  //       {
  //         journalTransactionId,
  //         targetStateId: TRANSACTION_STATE.CONFIRMED.id,
  //         historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
  //         updatedBy,
  //         completeJournal: true,
  //       },
  //       tx,
  //     );

  //     const clientBook = await this.findBookOrThrow(`stake:${journalTransaction.id}:client`, tx);
  //     const custodyBook = await this.findBookOrThrow(`stake:${journalTransaction.id}:custody`, tx);
  //     const stakedAmount = custodyBook.amount;

  //     await this.bookPostingRepository.createBookPosting(
  //       {
  //         bookId: custodyBook.id,
  //         journalTransactionId: journalTransaction.id,
  //         amount: `-${stakedAmount}`,
  //         assetTypeId: custodyBook.assetTypeId ?? 0,
  //         bookPostingPurposeId: BOOK_PURPOSE.CUSTODY_CONTROL_ACCOUNT.id,
  //         idempotencyToken: `${journalTransaction.idempotencyToken}:confirmed:custody`,
  //         historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
  //         createdBy: updatedBy,
  //                   bookPostingTypeId: BOOK_POSTING_PURPOSE.AMOUNT,
  //                   businessPostDateTime: request.businessPostDateTime
  //       },
  //       tx,
  //     );

  //     await this.bookPostingRepository.createBookPosting(
  //       {
  //         bookId: clientBook.id,
  //         journalTransactionId: journalTransaction.id,
  //         amount: stakedAmount,
  //         assetTypeId: clientBook.assetTypeId ?? 0,
  //         bookPostingPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
  //         idempotencyToken: `${journalTransaction.idempotencyToken}:confirmed:client`,
  //         historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
  //         createdBy: updatedBy,
  //                   bookPostingTypeId: BOOK_POSTING_PURPOSE.AMOUNT,
  //                   businessPostDateTime: request.businessPostDateTime
  //       },
  //       tx,
  //     );

  //     return journalTransaction;
  //   });
  // }

  // private async findBookOrThrow(name: string, tx: Transaction): Promise<Book> {
  //   const book = await Book.findOne({ where: { name }, transaction: tx, lock: tx.LOCK.UPDATE });
  //   if (!book) {
  //     throw new Error(`Book not found: ${name}`);
  //   }
  //   return book;
  // }
}
