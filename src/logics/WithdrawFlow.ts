import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { JournalTransaction } from '../models';
import { UnitOfWork } from '../common/UnitOfWork';
import { BookRepository, BookPostingRepository, JournalTransactionRepository } from '../repositories';
import { BOOK_PURPOSE, BOOK_POSTING_PURPOSE, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';
import { InsufficientBalanceError, InvalidStateTransitionError } from '../common/errors';
import { BaseTransactionRequest } from './types';
import { buildPostingIdempotencyToken } from './idempotency';

export interface WithdrawalAccount {
  clientId: number;
  accountId: number;
  assetId: number;
  assetTypeId: number;
  assetTicker: string;
  walletTypeId?: number | null;
  address?: string | null;
}

export interface WithdrawRequest extends BaseTransactionRequest {
  fromAccount?: WithdrawalAccount | null;
  toAccount?: WithdrawalAccount | null;
  amountAssetTypeId?: number | null;
  fee?: string;
  feeAssetTypeId?: number | null;
  feeAssetId?: number | null;
  feeWalletTypeId?: number | null;
  feeAddress?: string | null;
}

export type WithdrawTargetState = 'AUTHORIZED' | 'SENT' | 'CONFIRMING' | 'CONFIRMED';

const NEXT_WITHDRAW_STATE: Record<number, number> = {
  [TRANSACTION_STATE.AUTHORIZING.id]: TRANSACTION_STATE.AUTHORIZED.id,
  [TRANSACTION_STATE.AUTHORIZED.id]: TRANSACTION_STATE.SENT.id,
  [TRANSACTION_STATE.SENT.id]: TRANSACTION_STATE.CONFIRMING.id,
  [TRANSACTION_STATE.CONFIRMING.id]: TRANSACTION_STATE.CONFIRMED.id,
};

@singleton()
@autoInjectable()
export class WithdrawFlow {
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

  async create(request: WithdrawRequest): Promise<JournalTransaction> {
    return this.unitOfWork.execute(async (transaction: Transaction) => {
      const sourceAccount = request.fromAccount ?? {
        clientId: request.clientId,
        accountId: request.accountId,
        assetId: request.assetId,
        assetTypeId: request.amountAssetTypeId ?? request.assetTypeId,
        assetTicker: request.assetTicker,
        walletTypeId: request.walletTypeId,
        address: request.address ?? null,
      };

      const amountAssetTypeId = request.amountAssetTypeId ?? sourceAccount.assetTypeId;
      const feeAssetTypeId = request.feeAssetTypeId ?? amountAssetTypeId;
      const feeValue = BigInt(request.fee ?? '0');

      const { journalTransaction } = await this.journalTransactionRepository.getOrCreateJournalTransaction(
        {
          idempotencyToken: request.idempotencyToken,
          uuidToken: request.uuidToken,
          transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
          fromAccountId: sourceAccount.accountId,
          toAccountId: request.toAccount?.accountId ?? null,
          transactionHash: request.transactionHash ?? null,
          createdBy: request.createdBy ?? null,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
          transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.CREATED,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      if (journalTransaction.transactionStateId !== TRANSACTION_STATE.AUTHORIZING.id) {
        return journalTransaction;
      }

      const amountBook = await this.getOrCreateBookForAccount(
        {
          clientId: sourceAccount.clientId,
          accountId: sourceAccount.accountId,
          assetId: sourceAccount.assetId,
          assetTypeId: amountAssetTypeId,
          assetTicker: sourceAccount.assetTicker,
          walletTypeId: sourceAccount.walletTypeId ?? request.walletTypeId,
          address: sourceAccount.address ?? request.address ?? null,
        },
        BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
        TRANSACTION_STATE.AUTHORIZING.id,
        transaction,
      );

      const feeBook =
        feeValue > 0n
          ? await this.getOrCreateBookForAccount(
              {
                clientId: sourceAccount.clientId,
                accountId: sourceAccount.accountId,
                assetId: request.feeAssetId ?? sourceAccount.assetId,
                assetTypeId: feeAssetTypeId,
                assetTicker: request.assetTicker,
                walletTypeId: request.feeWalletTypeId ?? request.walletTypeId,
                address: request.feeAddress ?? sourceAccount.address ?? request.address ?? null,
              },
              BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
              TRANSACTION_STATE.AUTHORIZING.id,
              transaction,
            )
          : null;

      const destinationBook = request.toAccount
        ? await this.getOrCreateBookForAccount(
            {
              clientId: request.toAccount.clientId,
              accountId: request.toAccount.accountId,
              assetId: request.toAccount.assetId,
              assetTypeId: request.toAccount.assetTypeId,
              assetTicker: request.toAccount.assetTicker,
              walletTypeId: request.toAccount.walletTypeId ?? request.walletTypeId,
              address: request.toAccount.address ?? request.address ?? null,
            },
            request.fromAccount &&
              request.fromAccount.clientId === request.toAccount.clientId &&
              request.fromAccount.accountId === request.toAccount.accountId
              ? BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id
              : BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
            TRANSACTION_STATE.AUTHORIZING.id,
            transaction,
          )
        : null;

      const booksToLock = [amountBook, feeBook, destinationBook].filter((book): book is NonNullable<typeof book> => Boolean(book));
      await this.bookRepository.lockBooksInOrder(
        booksToLock.map((book) => book.id),
        transaction,
      );

      const amountBalance = BigInt(amountBook.amount ?? '0');
      const amountAfterDebit = amountBalance - BigInt(request.amount ?? '0');
      const feeAfterDebit = feeBook ? BigInt(feeBook.amount ?? '0') - feeValue : 0n;

      if (amountAfterDebit < 0n || (feeBook && feeAfterDebit < 0n)) {
        const reasons: string[] = [];
        if (amountAfterDebit < 0n) reasons.push(`amount assetTypeId=${amountAssetTypeId} insufficient after debit ${request.amount}`);
        if (feeBook && feeAfterDebit < 0n) reasons.push(`fee assetTypeId=${feeAssetTypeId} insufficient after debit ${request.fee}`);

        await this.rejectJournalTransaction(journalTransaction.id, request.createdBy ?? null, transaction, reasons.join('; '));
        throw new InsufficientBalanceError(amountBook.id, amountBook.amount ?? '0', reasons.join('; '));
      }

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: amountBook.id,
          journalTransactionId: journalTransaction.id,
          amount: `-${request.amount}`,
          assetTypeId: amountAssetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: request.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
            transactionStateId: TRANSACTION_STATE.AUTHORIZED.id,
            bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
            legIndex: 1,
          }),
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy ?? null,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      if (destinationBook) {
        await this.bookPostingRepository.createBookPosting(
          {
            bookId: destinationBook.id,
            journalTransactionId: journalTransaction.id,
            amount: request.amount,
            assetTypeId: amountAssetTypeId,
            bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
            idempotencyToken: buildPostingIdempotencyToken({
              idempotencyToken: request.idempotencyToken,
              transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
              transactionStateId: TRANSACTION_STATE.AUTHORIZED.id,
              bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
              legIndex: 2,
            }),
            historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
            createdBy: request.createdBy ?? null,
            businessPostDateTime: request.businessPostDateTime,
          },
          transaction,
        );
      }

      if (feeBook && feeValue > 0n && destinationBook) {
        await this.bookPostingRepository.createBookPosting(
          {
            bookId: feeBook.id,
            journalTransactionId: journalTransaction.id,
            amount: `-${request.fee}`,
            assetTypeId: feeAssetTypeId,
            bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,
            idempotencyToken: buildPostingIdempotencyToken({
              idempotencyToken: request.idempotencyToken,
              transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
              transactionStateId: TRANSACTION_STATE.AUTHORIZED.id,
              bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,
              legIndex: 1,
            }),
            historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
            createdBy: request.createdBy ?? null,
            businessPostDateTime: request.businessPostDateTime,
          },
          transaction,
        );

        await this.bookPostingRepository.createBookPosting(
          {
            bookId: destinationBook.id,
            journalTransactionId: journalTransaction.id,
            amount: String(request.fee ?? '0'),
            assetTypeId: feeAssetTypeId,
            bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,
            idempotencyToken: buildPostingIdempotencyToken({
              idempotencyToken: request.idempotencyToken,
              transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
              transactionStateId: TRANSACTION_STATE.AUTHORIZED.id,
              bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,
              legIndex: 2,
            }),
            historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
            createdBy: request.createdBy ?? null,
            businessPostDateTime: request.businessPostDateTime,
          },
          transaction,
        );
      }

      await this.journalTransactionRepository.updateJournalTransaction(
        {
          journalTransactionId: journalTransaction.id,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
          targetTransactionStateId: TRANSACTION_STATE.AUTHORIZED.id,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
          updatedBy: request.createdBy ?? null,
        },
        transaction,
      );

      return journalTransaction;
    });
  }

  async advance(
    journalTransactionId: number,
    targetState: WithdrawTargetState,
    transactionHash?: string | null,
    updatedBy?: number | null,
  ): Promise<JournalTransaction> {
    return this.unitOfWork.execute(async (transaction: Transaction) => {
      const journalTransaction = await JournalTransaction.findByPk(journalTransactionId, {
        transaction,
        lock: transaction.LOCK.UPDATE,
      });

      if (!journalTransaction) {
        throw new Error(`JournalTransaction ${journalTransactionId} not found`);
      }

      if (
        journalTransaction.journalTransactionState === JOURNAL_TRANSACTION_STATE.COMPLETED ||
        journalTransaction.journalTransactionState === JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED
      ) {
        return journalTransaction;
      }

      const currentStateId = journalTransaction.transactionStateId ?? TRANSACTION_STATE.AUTHORIZING.id;
      const targetStateId = TRANSACTION_STATE[targetState].id;
      const expectedNext = NEXT_WITHDRAW_STATE[currentStateId];

      if (expectedNext !== targetStateId) {
        await this.rejectJournalTransaction(
          journalTransaction.id,
          updatedBy ?? null,
          transaction,
          `invalid withdraw transition from ${currentStateId} to ${targetStateId}`,
        );
        throw new InvalidStateTransitionError(currentStateId, targetState);
      }

      return this.journalTransactionRepository.updateJournalTransaction(
        {
          journalTransactionId,
          journalTransactionState: targetState === 'CONFIRMED' ? JOURNAL_TRANSACTION_STATE.COMPLETED : JOURNAL_TRANSACTION_STATE.ACTIVE,
          targetTransactionStateId: targetStateId,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
          transactionHash: transactionHash ?? journalTransaction.transactionHash ?? null,
          updatedBy,
          completeJournal: targetState === 'CONFIRMED',
        },
        transaction,
      );
    });
  }

  private async getOrCreateBookForAccount(account: WithdrawalAccount, bookPurposeId: number, transactionStateId: number, transaction: Transaction) {
    const { book } = await this.bookRepository.getOrCreateBook(
      {
        name: bookPurposeId === BOOK_PURPOSE.EXTERNAL_ACCOUNT.id ? BOOK_PURPOSE.EXTERNAL_ACCOUNT.code : BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.code,
        bookPurposeId,
        transactionStateId,
        clientId: account.clientId,
        accountId: account.accountId,
        assetId: account.assetId,
        assetTypeId: account.assetTypeId,
        assetTicker: account.assetTicker,
        walletTypeId: account.walletTypeId ?? 1,
        address: account.address ?? null,
        createdBy: null,
      },
      transaction,
    );

    return book;
  }

  private async rejectJournalTransaction(
    journalTransactionId: number,
    updatedBy: number | null,
    transaction: Transaction,
    reason: string,
  ): Promise<void> {
    await this.journalTransactionRepository.updateJournalTransaction(
      {
        journalTransactionId,
        journalTransactionState: JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED,
        targetTransactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
        historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
        updatedBy,
        cancelJournal: true,
      },
      transaction,
    );
    if (reason) {
      // Lens for diagnostics; actual error is raised by the caller.
    }
  }
}
