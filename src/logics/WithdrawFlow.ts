import { autoInjectable, singleton } from 'tsyringe';

import { JournalTransaction } from '../models';
import { UnitOfWork } from '../common/UnitOfWork';

import { BookRepository, BookPostingRepository, JournalTransactionRepository } from '../repositories';

import { BOOK_PURPOSE, BOOK_POSTING_PURPOSE, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';

import { BaseTransactionRequest } from './types';
import { buildPostingIdempotencyToken } from './idempotency';

/**
 * ============================================================
 * Types
 * ============================================================
 */

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
  /**
   * Account that pays the withdrawal amount and fee.
   */
  fromAccount: WithdrawalAccount;

  toAccount?: WithdrawalAccount | null;

  amount: string;

  amountAssetTypeId: number;

  fee: string;

  feeAssetTypeId: number;

  transactionHash?: string | null;
}

export type WithdrawTargetState = 'AUTHORIZED' | 'SENT' | 'CONFIRMING' | 'CONFIRMED';

const NEXT_WITHDRAW_STATE: Record<number, number> = {
  [TRANSACTION_STATE.AUTHORIZING.id]: TRANSACTION_STATE.AUTHORIZED.id,

  [TRANSACTION_STATE.AUTHORIZED.id]: TRANSACTION_STATE.SENT.id,

  [TRANSACTION_STATE.SENT.id]: TRANSACTION_STATE.CONFIRMING.id,

  [TRANSACTION_STATE.CONFIRMING.id]: TRANSACTION_STATE.CONFIRMED.id,
};

export enum WithdrawalRejectReason {
  INVALID_REQUEST = 'INVALID_REQUEST',

  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',

  INSUFFICIENT_AMOUNT_BALANCE = 'INSUFFICIENT_AMOUNT_BALANCE',

  INSUFFICIENT_FEE_BALANCE = 'INSUFFICIENT_FEE_BALANCE',

  INSUFFICIENT_AMOUNT_AND_FEE_BALANCE = 'INSUFFICIENT_AMOUNT_AND_FEE_BALANCE',

  INVALID_FROM_ACCOUNT = 'INVALID_FROM_ACCOUNT',

  INVALID_TO_ACCOUNT = 'INVALID_TO_ACCOUNT',

  INVALID_ASSET = 'INVALID_ASSET',
}

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
    return this.unitOfWork.execute(async (transaction) => {
      this.validateRequest(request);

      this.validateAccounts(request);

      const { journalTransaction } = await this.journalTransactionRepository.getOrCreateJournalTransaction(
        {
          idempotencyToken: request.idempotencyToken,

          uuidToken: request.uuidToken,

          transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,

          fromAccountId: request.fromAccount.accountId,

          toAccountId: request.toAccount?.accountId ?? null,

          transactionHash: request.transactionHash ?? null,

          createdBy: request.createdBy,

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

      const books = await this.getWithdrawalBooks(request, journalTransaction.id, transaction);

      const booksToLock = [
        books.amountFromBook,
        books.feeFromBook,

        ...(books.amountToBook ? [books.amountToBook] : []),

        ...(books.feeToBook ? [books.feeToBook] : []),
      ];

      await this.bookRepository.lockBooksInOrder(
        booksToLock.map((book) => book.id),
        transaction,
      );

      const amountBalance = await this.bookRepository.getAvailableBalance(books.amountFromBook.id, request.amountAssetTypeId, transaction);

      const feeBalance = await this.bookRepository.getAvailableBalance(books.feeFromBook.id, request.feeAssetTypeId, transaction);

      const amountInsufficient = this.compareDecimal(amountBalance, request.amount) < 0;

      const feeInsufficient = this.compareDecimal(feeBalance, request.fee) < 0;

      if (amountInsufficient || feeInsufficient) {
        const reason =
          amountInsufficient && feeInsufficient
            ? WithdrawalRejectReason.INSUFFICIENT_AMOUNT_AND_FEE_BALANCE
            : amountInsufficient
              ? WithdrawalRejectReason.INSUFFICIENT_AMOUNT_BALANCE
              : WithdrawalRejectReason.INSUFFICIENT_FEE_BALANCE;

        return this.reject(journalTransaction.id, reason, request.createdBy, transaction);
      }

      await this.bookRepository.reserveBalance(
        {
          bookId: books.amountFromBook.id,

          assetTypeId: request.amountAssetTypeId,

          amount: request.amount,

          journalTransactionId: journalTransaction.id,

          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: request.idempotencyToken,

            transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,

            transactionStateId: TRANSACTION_STATE.AUTHORIZED.id,

            bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,

            legIndex: 1,
          }),
        },
        transaction,
      );

      if (this.isPositive(request.fee)) {
        await this.bookRepository.reserveBalance(
          {
            bookId: books.feeFromBook.id,

            assetTypeId: request.feeAssetTypeId,

            amount: request.fee,

            journalTransactionId: journalTransaction.id,

            idempotencyToken: buildPostingIdempotencyToken({
              idempotencyToken: request.idempotencyToken,

              transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,

              transactionStateId: TRANSACTION_STATE.AUTHORIZED.id,

              bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,

              legIndex: 1,
            }),
          },
          transaction,
        );
      }

      const updated = await this.journalTransactionRepository.updateJournalTransaction(
        {
          journalTransactionId: journalTransaction.id,

          journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,

          targetTransactionStateId: TRANSACTION_STATE.AUTHORIZED.id,

          historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,

          updatedBy: request.createdBy,
        },
        transaction,
      );

      return updated;
    });
  }

  async advance(
    journalTransactionId: number,

    targetState: WithdrawTargetState,

    transactionHash?: string | null,

    updatedBy?: number | null,
  ): Promise<JournalTransaction> {
    return this.unitOfWork.execute(async (transaction) => {
      const journal = await this.journalTransactionRepository.findByIdForUpdate(journalTransactionId, transaction);

      if (!journal) {
        throw new Error(`Journal transaction ${journalTransactionId} not found`);
      }

      if (journal.transactionStateId === TRANSACTION_STATE.REJECTED.id) {
        throw new Error(`Journal transaction ${journalTransactionId} is already rejected`);
      }

      if (journal.transactionStateId === TRANSACTION_STATE.CONFIRMED.id) {
        if (targetState === 'CONFIRMED') {
          return journal;
        }

        throw new Error(`Invalid transition: CONFIRMED -> ${targetState}`);
      }

      const currentStateId = journal.transactionStateId;

      const expectedNextStateId = NEXT_WITHDRAW_STATE[currentStateId];

      const targetStateId = TRANSACTION_STATE[targetState].id;

      if (currentStateId === targetStateId) {
        return journal;
      }

      /**
       * --------------------------------------------------------
       * STRICT TRANSITION
       * --------------------------------------------------------
       */

      if (expectedNextStateId !== targetStateId) {
        return this.reject(
          journal.id,

          WithdrawalRejectReason.INVALID_STATE_TRANSITION,

          updatedBy,

          transaction,
        );
      }

      /**
       * --------------------------------------------------------
       * State-specific operations
       * --------------------------------------------------------
       */

      switch (targetState) {
        case 'SENT':
          return this.markSent(journal, transactionHash, updatedBy, transaction);

        case 'CONFIRMING':
          return this.markConfirming(journal, updatedBy, transaction);

        case 'CONFIRMED':
          return this.confirm(journal, transactionHash, updatedBy, transaction);

        case 'AUTHORIZED':
          return this.journalTransactionRepository.updateJournalTransaction(
            {
              journalTransactionId: journal.id,

              journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,

              targetTransactionStateId: TRANSACTION_STATE.AUTHORIZED.id,

              historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,

              updatedBy,
            },
            transaction,
          );

        default:
          throw new Error(`Unsupported withdrawal state: ${targetState}`);
      }
    });
  }

  private async markSent(
    journal: JournalTransaction,

    transactionHash: string | null | undefined,

    updatedBy: number | null | undefined,

    transaction: any,
  ): Promise<JournalTransaction> {
    return this.journalTransactionRepository.updateJournalTransaction(
      {
        journalTransactionId: journal.id,

        journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,

        targetTransactionStateId: TRANSACTION_STATE.SENT.id,

        transactionHash: transactionHash ?? undefined,

        historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,

        updatedBy,
      },
      transaction,
    );
  }

  private async markConfirming(
    journal: JournalTransaction,

    updatedBy: number | null | undefined,

    transaction: any,
  ): Promise<JournalTransaction> {
    return this.journalTransactionRepository.updateJournalTransaction(
      {
        journalTransactionId: journal.id,

        journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,

        targetTransactionStateId: TRANSACTION_STATE.CONFIRMING.id,

        historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,

        updatedBy,
      },
      transaction,
    );
  }

  private async confirm(
    journal: JournalTransaction,

    transactionHash: string | null | undefined,

    updatedBy: number | null | undefined,

    transaction: any,
  ): Promise<JournalTransaction> {
    const withdrawal = await this.journalTransactionRepository.getWithdrawalDetail(journal.id, transaction);

    if (!withdrawal) {
      throw new Error(`Withdrawal detail not found for journal ${journal.id}`);
    }

    const books = await this.getWithdrawalBooksByJournal(journal, withdrawal, transaction);

    const booksToLock = [books.amountFromBook, books.feeFromBook, ...(books.amountToBook ? [books.amountToBook] : []), books.feeToBook];

    await this.bookRepository.lockBooksInOrder(
      booksToLock.map((book) => book.id),
      transaction,
    );

    await this.bookRepository.finalizeReservedBalance(
      {
        bookId: books.amountFromBook.id,

        assetTypeId: withdrawal.amountAssetTypeId,

        amount: withdrawal.amount,

        journalTransactionId: journal.id,

        idempotencyToken: buildPostingIdempotencyToken({
          idempotencyToken: withdrawal.idempotencyToken,

          transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,

          transactionStateId: TRANSACTION_STATE.CONFIRMED.id,

          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,

          legIndex: 1,
        }),
      },
      transaction,
    );

    await this.bookPostingRepository.createBookPosting(
      {
        bookId: books.amountToBook!.id,

        journalTransactionId: journal.id,

        amount: withdrawal.amount,

        assetTypeId: withdrawal.amountAssetTypeId,

        bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,

        idempotencyToken: buildPostingIdempotencyToken({
          idempotencyToken: withdrawal.idempotencyToken,

          transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,

          transactionStateId: TRANSACTION_STATE.CONFIRMED.id,

          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,

          legIndex: 2,
        }),

        historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,

        createdBy: updatedBy,

        businessPostDateTime: withdrawal.businessPostDateTime,
      },
      transaction,
    );

    if (this.isPositive(withdrawal.fee)) {
      await this.bookRepository.finalizeReservedBalance(
        {
          bookId: books.feeFromBook.id,

          assetTypeId: withdrawal.feeAssetTypeId,

          amount: withdrawal.fee,

          journalTransactionId: journal.id,

          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: withdrawal.idempotencyToken,

            transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,

            transactionStateId: TRANSACTION_STATE.CONFIRMED.id,

            bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,

            legIndex: 1,
          }),
        },
        transaction,
      );

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: books.feeToBook.id,

          journalTransactionId: journal.id,

          amount: withdrawal.fee,

          assetTypeId: withdrawal.feeAssetTypeId,

          bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,

          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: withdrawal.idempotencyToken,

            transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,

            transactionStateId: TRANSACTION_STATE.CONFIRMED.id,

            bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,

            legIndex: 2,
          }),

          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,

          createdBy: updatedBy,

          businessPostDateTime: withdrawal.businessPostDateTime,
        },
        transaction,
      );
    }

    return this.journalTransactionRepository.updateJournalTransaction(
      {
        journalTransactionId: journal.id,

        journalTransactionState: JOURNAL_TRANSACTION_STATE.COMPLETED,

        targetTransactionStateId: TRANSACTION_STATE.CONFIRMED.id,

        transactionHash: transactionHash ?? undefined,

        historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,

        updatedBy,

        completeJournal: true,
      },
      transaction,
    );
  }

  /**
   * ==========================================================
   * BOOK RESOLUTION
   * ==========================================================
   */

  private async getWithdrawalBooks(
    request: WithdrawRequest,

    journalTransactionId: number,

    transaction: any,
  ) {
    /**
     * Amount source.
     *
     * Example:
     *
     *   Alice USDT
     */

    const amountFromBook = await this.getOrCreateAssetBook(
      BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT,

      request.fromAccount,

      request.amountAssetTypeId,

      journalTransactionId,

      transaction,
    );

    /**
     * Amount destination.
     *
     * Internal:
     *
     *   toAccount != null
     *
     * External:
     *
     *   toAccount == null
     */

    let amountToBook;

    if (request.toAccount) {
      amountToBook = await this.getOrCreateAssetBook(
        BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT,

        request.toAccount,

        request.amountAssetTypeId,

        journalTransactionId,

        transaction,
      );
    } else {
      amountToBook = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.EXTERNAL_ACCOUNT.code,

          bookPurposeId: BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,

          transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,

          clientId: request.fromAccount.clientId,

          accountId: request.fromAccount.accountId,

          assetId: request.fromAccount.assetId,

          assetTypeId: request.amountAssetTypeId,

          assetTicker: request.fromAccount.assetTicker,

          walletTypeId: request.fromAccount.walletTypeId,

          address: request.fromAccount.address,

          createdBy: request.createdBy,
        },
        transaction,
      );

      amountToBook = amountToBook.book;
    }

    /**
     * Fee source.
     *
     * Notice:
     *
     *   feeAssetTypeId
     *
     * is deliberately used here.
     */

    const feeFromBook = await this.getOrCreateAssetBook(
      BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT,

      request.fromAccount,

      request.feeAssetTypeId,

      journalTransactionId,

      transaction,
    );

    /**
     * Fee destination.
     */

    const feeToBook = await this.bookRepository.getOrCreateBook(
      {
        name: BOOK_PURPOSE.BLOCKCHAIN_CONTROL_ACCOUNT.code,

        bookPurposeId: BOOK_PURPOSE.BLOCKCHAIN_CONTROL_ACCOUNT.id,

        transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,

        clientId: request.fromAccount.clientId,

        accountId: request.fromAccount.accountId,

        /**
         * IMPORTANT:
         *
         * Fee book belongs to fee asset.
         */
        assetId: request.fromAccount.assetId,

        assetTypeId: request.feeAssetTypeId,

        assetTicker: request.feeAssetTypeId === request.amountAssetTypeId ? request.fromAccount.assetTicker : request.fromAccount.assetTicker,

        walletTypeId: request.fromAccount.walletTypeId,

        address: request.fromAccount.address,

        createdBy: request.createdBy,
      },
      transaction,
    );

    return {
      amountFromBook,
      amountToBook,

      feeFromBook,

      feeToBook: feeToBook.book,
    };
  }

  /**
   * ==========================================================
   * BOOK RESOLUTION FOR CONFIRM
   * ==========================================================
   */

  private async getWithdrawalBooksByJournal(journal: JournalTransaction, withdrawal: any, transaction: any) {
    const amountFromBook = await this.bookRepository.findBookOrThrow(
      {
        purposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,

        accountId: withdrawal.fromAccountId,

        assetTypeId: withdrawal.amountAssetTypeId,
      },
      transaction,
    );

    const feeFromBook = await this.bookRepository.findBookOrThrow(
      {
        purposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,

        accountId: withdrawal.fromAccountId,

        assetTypeId: withdrawal.feeAssetTypeId,
      },
      transaction,
    );

    let amountToBook;

    if (withdrawal.toAccountId) {
      amountToBook = await this.bookRepository.findBookOrThrow(
        {
          purposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,

          accountId: withdrawal.toAccountId,

          assetTypeId: withdrawal.amountAssetTypeId,
        },
        transaction,
      );
    } else {
      amountToBook = await this.bookRepository.findBookOrThrow(
        {
          purposeId: BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,

          accountId: withdrawal.fromAccountId,

          assetTypeId: withdrawal.amountAssetTypeId,
        },
        transaction,
      );
    }

    const feeToBook = await this.bookRepository.findBookOrThrow(
      {
        purposeId: BOOK_PURPOSE.BLOCKCHAIN_CONTROL_ACCOUNT.id,

        accountId: withdrawal.fromAccountId,

        assetTypeId: withdrawal.feeAssetTypeId,
      },
      transaction,
    );

    return {
      amountFromBook,
      amountToBook,
      feeFromBook,
      feeToBook,
    };
  }

  private async getOrCreateAssetBook(
    purpose: {
      code: string;
      id: number;
    },

    account: WithdrawalAccount,

    assetTypeId: number,

    journalTransactionId: number,

    transaction: any,
  ) {
    const result = await this.bookRepository.getOrCreateBook(
      {
        name: purpose.code,

        bookPurposeId: purpose.id,

        transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,

        clientId: account.clientId,

        accountId: account.accountId,

        assetId: account.assetId,

        assetTypeId,

        assetTicker: account.assetTicker,

        walletTypeId: account.walletTypeId,

        address: account.address,

        createdBy: undefined,
      },
      transaction,
    );

    return result.book;
  }

  /**
   * ==========================================================
   * REJECT
   * ==========================================================
   */

  private async reject(
    journalTransactionId: number,

    reason: WithdrawalRejectReason,

    updatedBy: number | null | undefined,

    transaction: any,
  ): Promise<JournalTransaction> {
    /**
     * Important:
     *
     * REJECTED must be terminal.
     *
     * If the journal has reservations already, this method
     * should release them before setting REJECTED.
     *
     * During initial authorization balance failure there is
     * normally no reservation yet.
     */

    return this.journalTransactionRepository.rejectJournalTransaction(
      {
        journalTransactionId,

        transactionStateId: TRANSACTION_STATE.REJECTED.id,

        journalTransactionState: JOURNAL_TRANSACTION_STATE.CANCELLED_OR_EXPIRED,

        rejectionReason: reason,

        historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,

        updatedBy,
      },
      transaction,
    );
  }

  private validateRequest(request: WithdrawRequest): void {
    if (!request.amount) {
      throw new Error('Withdrawal amount is required');
    }

    if (this.compareDecimal(request.amount, '0') <= 0) {
      throw new Error('Withdrawal amount must be greater than zero');
    }

    if (request.fee === undefined || request.fee === null) {
      throw new Error('Withdrawal fee is required');
    }

    if (this.compareDecimal(request.fee, '0') < 0) {
      throw new Error('Withdrawal fee cannot be negative');
    }

    if (!request.amountAssetTypeId) {
      throw new Error('amountAssetTypeId is required');
    }

    if (!request.feeAssetTypeId) {
      throw new Error('feeAssetTypeId is required');
    }

    if (!request.fromAccount) {
      throw new Error('fromAccount is required');
    }
  }

  private validateAccounts(request: WithdrawRequest): void {
    const from = request.fromAccount;
    const to = request.toAccount;

    if (!from.accountId) {
      throw new Error('fromAccount.accountId is required');
    }

    if (!from.clientId) {
      throw new Error('fromAccount.clientId is required');
    }

    if (to) {
      if (!to.accountId) {
        throw new Error('toAccount.accountId is required');
      }

      if (!to.clientId) {
        throw new Error('toAccount.clientId is required');
      }

      if (to.assetTypeId !== request.amountAssetTypeId) {
        throw new Error('Internal withdrawal toAccount asset must match amount asset');
      }
    }
  }

  private compareDecimal(a: string, b: string): number {
    const normalize = (value: string) => {
      const [integer, fraction = ''] = value.split('.');

      const negative = integer.startsWith('-');

      const absoluteInteger = negative ? integer.slice(1) : integer;

      const normalizedFraction = fraction.replace(/0+$/, '');

      return {
        negative,

        integer: absoluteInteger.replace(/^0+/, '') || '0',

        fraction: normalizedFraction,
      };
    };

    const x = normalize(a);
    const y = normalize(b);

    if (x.negative !== y.negative) {
      return x.negative ? -1 : 1;
    }

    const sign = x.negative ? -1 : 1;

    if (x.integer.length !== y.integer.length) {
      return (x.integer.length > y.integer.length ? 1 : -1) * sign;
    }

    if (x.integer !== y.integer) {
      return (x.integer > y.integer ? 1 : -1) * sign;
    }

    const maxLength = Math.max(x.fraction.length, y.fraction.length);

    const xf = x.fraction.padEnd(maxLength, '0');

    const yf = y.fraction.padEnd(maxLength, '0');

    if (xf === yf) {
      return 0;
    }

    return (xf > yf ? 1 : -1) * sign;
  }

  private isPositive(value: string): boolean {
    return this.compareDecimal(value, '0') > 0;
  }
}
