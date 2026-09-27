import { autoInjectable, singleton } from 'tsyringe';

import { JournalTransaction } from '../models';
import { UnitOfWork } from '../common/UnitOfWork';
import { BookRepository, BookPostingRepository, JournalTransactionRepository } from '../repositories';
import { BOOK_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, BOOK_POSTING_PURPOSE } from '../constants';
import { BaseTransactionRequest } from './types';
import { buildPostingIdempotencyToken } from './idempotency';

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
 * VỀ IDEMPOTENCY TOKEN CỦA CÁC POSTING (đã sửa 1 bug nghiêm trọng):
 *
 * Bản cũ sinh `const uuid = randomUUID()` MỚI ở đầu mỗi lần gọi create()/
 * confirm(), rồi dùng uuid đó làm idempotencyToken cho 2 posting. Vì uuid
 * này luôn khác nhau giữa các lần gọi, nên nếu cùng 1 deposit event bị gửi
 * lại (duplicate webhook, message queue redeliver, client retry do timeout
 * ở tầng gateway...), getOrCreateJournalTransaction ĐÚNG là trả về journal
 * đã tồn tại (dedupe theo request.idempotencyToken) — nhưng code sau đó vẫn
 * vô tư tạo posting MỚI với token ngẫu nhiên mới, và createBookPosting
 * không có cách nào biết đây là bản ghi trùng. Kết quả: tiền bị cộng/trừ
 * thêm 1 lần mỗi khi event bị gửi lại — hoàn toàn vô hiệu hoá mục đích của
 * idempotency, và nguy hiểm hơn nhiều so với việc thiếu unique constraint.
 *
 * Cách sửa: token của mỗi posting được SUY RA (deterministic) từ
 * request.idempotencyToken theo format:
 *
 *   {idempotencyToken}-{transactionTypeId}-{transactionStateId}-{bookPostingPurposeId}-{legIndex}
 *
 * Nhờ vậy, gọi lại y hệt request cũ (idempotencyToken cũ) luôn tính ra ĐÚNG
 * token cũ, và BookPostingRepository.createBookPosting (đã có unique
 * constraint DB + lock-trước-rồi-mới-check ở lần sửa trước) sẽ nhận diện
 * đúng đây là duplicate và bỏ qua việc cộng/trừ tiền lần 2.
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

      const { book: book1 } = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.EXTERNAL_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.NOT_APPLICABLE.id,
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

      const { book: book2 } = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
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

      // Format token: xem giải thích ở đầu file. Cả 2 vế đều thuộc bucket
      // CONFIRMING (book vừa mở ở state này) nên dùng chung transactionStateId,
      // phân biệt nhau bằng legIndex.
      const externalToken = buildPostingIdempotencyToken({
        idempotencyToken: request.idempotencyToken,
        transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
        transactionStateId: TRANSACTION_STATE.NOT_APPLICABLE.id,
        bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
        legIndex: 1,
      });
      const clientToken = buildPostingIdempotencyToken({
        idempotencyToken: request.idempotencyToken,
        transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
        transactionStateId: TRANSACTION_STATE.CONFIRMING.id,
        bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
        legIndex: 2,
      });

      // Ghi nhận số dư ban đầu của book external bằng 1 posting để có audit trail
      // đầy đủ (thay vì set thẳng Book.amount lúc create như code cũ).
      await this.bookPostingRepository.createBookPosting(
        {
          bookId: book1.id,
          journalTransactionId: journalTransaction.id,
          amount: String(-BigInt(request.amount)),
          assetTypeId: request.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: externalToken,
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
          idempotencyToken: clientToken,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
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

      const { book: book1 } = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
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

      const { book: book2 } = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
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

      // Bước confirm() nhắm tới state đích CONFIRMED — cả 2 vế dùng chung
      // transactionStateId = CONFIRMED (đúng state ĐÍCH của bước này, không
      // phải state hiện tại của từng book), phân biệt nhau bằng legIndex 1/2.
      const fromToken = buildPostingIdempotencyToken({
        idempotencyToken: request.idempotencyToken,
        transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
        transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
        bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
        legIndex: 1,
      });
      const toToken = buildPostingIdempotencyToken({
        idempotencyToken: request.idempotencyToken,
        transactionTypeId: TRANSACTION_TYPE.DEPOSIT,
        transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
        bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
        legIndex: 2,
      });

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: book1.id,
          journalTransactionId: journalTransaction.id,
          amount: String(-BigInt(request.amount)),
          assetTypeId: request.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: fromToken,
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
          idempotencyToken: toToken,
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
