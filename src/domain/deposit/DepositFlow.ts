import { autoInjectable, singleton } from 'tsyringe';

import { JournalTransaction } from '../../models';
import { UnitOfWork } from '../../common/UnitOfWork';
import { BookRepository, BookPostingRepository, JournalTransactionRepository } from '../../repositories';
import {
  BOOK_PURPOSE,
  TRANSACTION_STATE,
  TRANSACTION_TYPE,
  HISTORY_EVENT_TYPE,
  JOURNAL_TRANSACTION_STATE,
  BOOK_POSTING_PURPOSE,
} from '../../constants';
import { AssetBookDescriptor, BaseTransactionRequest } from '../shared/types';
import { openBook } from '../shared/bookAccess';
import { postDoubleEntry } from '../shared/doubleEntryPosting';

export interface DepositRequest extends BaseTransactionRequest {
  /**
   * Deposit: tài khoản đích nhận tiền là `book.accountId`.
   * Nếu flow cần thêm account khác ở tương lai (ví dụ deposit từ external
   * account to user account), nên khai báo rõ `fromAccountId` / `toAccountId` ở
   * đây thay vì lạm dụng chung `accountId`.
   */
  toAccountId?: number | null;
}

/**
 * Deposit lifecycle:
 *   CONFIRMING -> CONFIRMED
 *
 * Books:
 *   1. EXTERNAL_ACCOUNT     (mở sẵn với số dư = amount, đại diện tiền đã vào ví)
 *   2. CUSTODY_ASSET_ACCOUNT (mở với số dư 0, chỉ được cộng khi confirm)
 *
 * CONFIRMING: chưa nhả tiền cho client.
 * CONFIRMED : EXTERNAL -amount / CLIENT +amount.
 *
 * ------------------------------------------------------------------------
 * VỀ IDEMPOTENCY TOKEN CỦA CÁC POSTING:
 *
 * Token của mỗi posting được SUY RA (deterministic) từ request.idempotencyToken
 * qua `postDoubleEntry()` (xem domain/shared/doubleEntryPosting.ts), theo format:
 *
 *   {idempotencyToken}-{transactionTypeId}-{transactionStateId}-{bookPostingPurposeId}-{legIndex}
 *
 * Nhờ vậy, gọi lại y hệt request cũ (idempotencyToken cũ) luôn tính ra ĐÚNG
 * token cũ, và BookPostingRepository.createBookPosting (unique constraint DB +
 * lock-trước-rồi-mới-check) sẽ nhận diện đúng đây là duplicate và bỏ qua việc
 * cộng/trừ tiền lần 2.
 */
@singleton()
@autoInjectable()
export class DepositFlow {
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

  private assetOf(request: DepositRequest): AssetBookDescriptor {
    return {
      clientId: request.clientId,
      accountId: request.accountId,
      assetId: request.assetId,
      assetTypeId: request.assetTypeId,
      assetTicker: request.assetTicker,
      walletTypeId: request.walletTypeId,
      address: request.address ?? null,
    };
  }

  async create(request: DepositRequest): Promise<JournalTransaction> {
    return this.unitOfWork.execute(async (transaction) => {
      const { journalTransaction } = await this.journalTransactionRepository.getOrCreateJournalTransaction(
        {
          idempotencyToken: request.idempotencyToken,
          uuidToken: request.uuidToken,
          transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
          fromAccountId: null,
          toAccountId: request.accountId,
          transactionHash: request.transactionHash,
          createdBy: request.createdBy,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
          transactionStateId: TRANSACTION_STATE.CONFIRMING.id,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.CREATED,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      const asset = this.assetOf(request);

      const externalBook = await openBook(
        this.bookRepository,
        {
          code: BOOK_PURPOSE.EXTERNAL_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.NOT_APPLICABLE.id,
          asset,
          createdBy: request.createdBy,
        },
        transaction,
      );
      const custodyConfirmingBook = await openBook(
        this.bookRepository,
        {
          code: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.CONFIRMING.id,
          asset,
          createdBy: request.createdBy,
        },
        transaction,
      );

      // Ghi nhận số dư ban đầu của book external bằng 1 cặp posting đối ứng
      // để có audit trail đầy đủ (thay vì set thẳng Book.amount lúc create).
      // Cả 2 vế đều thuộc bucket CONFIRMING (book vừa mở ở state này).
      await postDoubleEntry(
        this.bookPostingRepository,
        {
          journalTransactionId: journalTransaction.id,
          fromBook: externalBook,
          toBook: custodyConfirmingBook,
          amount: request.amount,
          assetTypeId: request.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
          idempotencyToken: request.idempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
          tokenStateId: TRANSACTION_STATE.CONFIRMING.id,
        },
        transaction,
      );

      return journalTransaction;
    });
  }

  async confirm(request: DepositRequest): Promise<JournalTransaction> {
    return this.unitOfWork.execute(async (transaction) => {
      const { journalTransaction } = await this.journalTransactionRepository.getOrCreateJournalTransaction(
        {
          idempotencyToken: request.idempotencyToken,
          uuidToken: request.uuidToken,
          transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
          fromAccountId: null,
          toAccountId: request.accountId,
          transactionHash: request.transactionHash,
          createdBy: request.createdBy,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
          transactionStateId: TRANSACTION_STATE.CONFIRMING.id,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.CREATED,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      const asset = this.assetOf(request);

      const custodyConfirmingBook = await openBook(
        this.bookRepository,
        {
          code: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.CONFIRMING.id,
          asset,
          createdBy: request.createdBy,
        },
        transaction,
      );
      const custodyConfirmedBook = await openBook(
        this.bookRepository,
        {
          code: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
          asset,
          createdBy: request.createdBy,
        },
        transaction,
      );

      // Bước confirm() nhắm tới state đích CONFIRMED — cả 2 vế dùng chung
      // tokenStateId = CONFIRMED (state ĐÍCH của bước này, không phải state
      // hiện tại của từng book).
      await postDoubleEntry(
        this.bookPostingRepository,
        {
          journalTransactionId: journalTransaction.id,
          fromBook: custodyConfirmingBook,
          toBook: custodyConfirmedBook,
          amount: request.amount,
          assetTypeId: request.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
          idempotencyToken: request.idempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
          tokenStateId: TRANSACTION_STATE.CONFIRMED.id,
        },
        transaction,
      );

      await this.journalTransactionRepository.updateJournalTransaction(
        {
          journalTransactionId: journalTransaction.id,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.COMPLETED,
          targetTransactionStateId: TRANSACTION_STATE.CONFIRMED.id,
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
