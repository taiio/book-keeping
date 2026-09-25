import { Transaction } from 'sequelize';
import { randomUUID } from 'crypto';
import { autoInjectable, singleton } from 'tsyringe';

import { Book, JournalTransaction } from '../models';
import { UnitOfWork } from '../common/UnitOfWork';
import { BookRepository, BookPostingRepository, JournalTransactionRepository } from '../repositories';
import { BOOK_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, BOOK_POSTING_PURPOSE } from '../constants';
import { BaseTransactionRequest } from './types';

export type DepositRequest = BaseTransactionRequest;

/**
 * Deposit lifecycle:
 *   CONFIRMING -> CONFIRMED
 *
 * Books:
 *   1. EXTERNAL_ACCOUNT     (mở sẵn với số dư = amount, đại diện tiền đã vào ví)
 *   2. CLIENT_ASSET_ACCOUNT (mở với số dư 0, chỉ được cộng khi confirm)
 *
 * CONFIRMING: chưa nhả tiền cho client.
 * CONFIRMED : EXTERNAL -amount / CLIENT +amount.
 */

@singleton()
@autoInjectable()
export class DepositFlow {
  private readonly unitOfWork: UnitOfWork;
  private readonly journalTransactionRepository: JournalTransactionRepository;
  private readonly bookRepository: BookRepository;
  private readonly bookPostingRepository: BookPostingRepository;

  constructor(
    unitOfWork: UnitOfWork,
    journalTransactionRepository: JournalTransactionRepository,
    bookRepository: BookRepository,
    bookPostingRepository: BookPostingRepository,
  ) {
    this.unitOfWork = unitOfWork!;
    this.journalTransactionRepository = journalTransactionRepository!;
    this.bookRepository = bookRepository!;
    this.bookPostingRepository = bookPostingRepository!;
  }

  async create(request: DepositRequest): Promise<JournalTransaction> {
    return this.unitOfWork.execute(async (transaction) => {
      const journalTransaction = await this.journalTransactionRepository.getOrCreateJournalTransaction(
        {
          idempotencyToken: request.idempotencyToken,
          uuidToken: request.uuidToken,
          transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
          fromAccountId: null,
          toAccountId: request.accountId,
          transactionHash: request.transactionHash,
          createdBy: request.createdBy,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.CREATED,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      const book1 = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.EXTERNAL_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.CONFIRMING.id,
          clientId: request.clientId,
          accountId: request.accountId,
          assetId: request.assetId,
          assetTypeId: request.assetTypeId,
          assetTicker: request.assetTicker,
          walletTypeId: request.walletTypeId,
          address: request.address,
          createdBy: request.createdBy,
        },
        transaction,
      );

      const book2 = await this.bookRepository.getOrCreateBook(
        {
          idempotencyToken: randomUUID(),
          name: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.CONFIRMING.id,
          clientId: request.clientId,
          accountId: request.accountId,
          assetId: request.assetId,
          assetTypeId: request.assetTypeId,
          assetTicker: request.assetTicker,
          walletTypeId: request.walletTypeId,
          address: request.address,
          createdBy: request.createdBy,
        },
        transaction,
      );
      const uuid = randomUUID();
      const idempotencyToken1 = uuid + '-' + TRANSACTION_TYPE.DEPOSIT + '-1';
      const idempotencyToken2 = uuid + '-' + TRANSACTION_TYPE.DEPOSIT + '-2';

      // Ghi nhận số dư ban đầu của book external bằng 1 posting để có audit trail
      // đầy đủ (thay vì set thẳng Book.amount lúc create như code cũ).

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: book1.id,
          journalTransactionId: journalTransaction.id,
          amount: String(-BigInt(request.amount)),
          assetTypeId: request.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: idempotencyToken1,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: book2.id,
          journalTransactionId: journalTransaction.id,
          amount: request.amount,
          assetTypeId: request.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: idempotencyToken2,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      // const bookAmount1 = {
      //   book: book1,
      //   ...book1,
      //   amountDelta: -BigInt(request.amount).toString(),
      // };

      // const bookAmount2 = {
      //   book: book2,
      //   ...book2,
      //   amountDelta: BigInt(request.amount).toString(),
      // };
      // console.log(book1);
      // await this.bookRepository.updateBook(bookAmount1 as any, transaction);
      // await this.bookRepository.updateBook(bookAmount2 as any, transaction);

      return journalTransaction;
    });
  }

  async confirm(request: any): Promise<JournalTransaction> {
    return this.unitOfWork.execute(async (transaction) => {
      const journalTransaction = await this.journalTransactionRepository.getOrCreateJournalTransaction(request, transaction);

      const book1 = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.CONFIRMING.id,
          clientId: request.clientId,
          accountId: request.accountId,
          assetId: request.assetId,
          assetTypeId: request.assetTypeId,
          assetTicker: request.assetTicker,
          walletTypeId: request.walletTypeId,
          address: request.address,
          createdBy: request.createdBy,
        },
        transaction,
      );

      const book2 = await this.bookRepository.getOrCreateBook(
        {
          idempotencyToken: randomUUID(),
          name: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
          clientId: request.clientId,
          accountId: request.accountId,
          assetId: request.assetId,
          assetTypeId: request.assetTypeId,
          assetTicker: request.assetTicker,
          walletTypeId: request.walletTypeId,
          address: request.address,
          createdBy: request.createdBy,
        },
        transaction,
      );
      const uuid = randomUUID();
      const idempotencyToken1 = uuid + '-' + TRANSACTION_TYPE.DEPOSIT + '-3';
      const idempotencyToken2 = uuid + '-' + TRANSACTION_TYPE.DEPOSIT + '-4';

      // Ghi nhận số dư ban đầu của book external bằng 1 posting để có audit trail
      // đầy đủ (thay vì set thẳng Book.amount lúc create như code cũ).

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: book1.id,
          journalTransactionId: journalTransaction.id,
          amount: String(-BigInt(request.amount)),
          assetTypeId: request.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: idempotencyToken1,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: book2.id,
          journalTransactionId: journalTransaction.id,
          amount: request.amount,
          assetTypeId: request.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: idempotencyToken2,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );
      await this.journalTransactionRepository.updateJournalTransaction(
        {
          journalTransactionId: journalTransaction.id,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.COMPLETED,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
          updatedBy: request.createdBy,
          completeJournal: true,
        },
        transaction,
      );
      return journalTransaction;
    });
  }
}
