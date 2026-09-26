import { autoInjectable, singleton } from 'tsyringe';

import { Book, BookPosting, JournalTransaction } from '../models';
import { UnitOfWork } from '../common/UnitOfWork';
import { BookRepository, BookPostingRepository, JournalTransactionRepository } from '../repositories';
import { BOOK_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, BOOK_POSTING_PURPOSE } from '../constants';
import { NotFoundError } from '../common/errors';
import { BaseTransactionRequest } from './types';
import { buildPostingIdempotencyToken } from './idempotency';

export type StakeRequest = BaseTransactionRequest;

/**
 * Stake lifecycle:
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

  async create(request: StakeRequest): Promise<JournalTransaction> {
    return this.unitOfWork.execute(async (transaction) => {
      const { journalTransaction } = await this.journalTransactionRepository.getOrCreateJournalTransaction(
        {
          idempotencyToken: request.idempotencyToken,
          uuidToken: request.uuidToken,
          transactionTypeId: TRANSACTION_TYPE.STAKE,
          fromAccountId: request.accountId,
          toAccountId: null,
          transactionHash: request.transactionHash,
          createdBy: request.createdBy,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
          transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.CREATED,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      const { book: clientBook } = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
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

      const { book: custodyBook } = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CUSTODY_CONTROL_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_CONTROL_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
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

      // Lock cả 2 book theo thứ tự id tăng dần trước khi post — tránh
      // deadlock với 1 unstake khác đang chạy song song trên đúng 2 book này.
      await this.bookRepository.lockBooksInOrder([clientBook.id, custodyBook.id], transaction);

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: clientBook.id,
          journalTransactionId: journalTransaction.id,
          amount: `-${request.amount}`,
          assetTypeId: request.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: request.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.STAKE,
            transactionStateId: TRANSACTION_STATE.AUTHORIZED.id,
            bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
            legIndex: 1,
          }),
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: custodyBook.id,
          journalTransactionId: journalTransaction.id,
          amount: request.amount,
          assetTypeId: request.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: request.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.STAKE,
            transactionStateId: TRANSACTION_STATE.AUTHORIZED.id,
            bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
            legIndex: 2,
          }),
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      // Đánh dấu đã khoá tài sản xong (audit trail — journal_transaction_state
      // vẫn ở ACTIVE, chưa COMPLETED, vì vòng đời còn tiếp tục tới unstake).
      await this.journalTransactionRepository.updateJournalTransaction(
        {
          journalTransactionId: journalTransaction.id,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.ACTIVE,
          targetTransactionStateId: TRANSACTION_STATE.AUTHORIZED.id,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
          updatedBy: request.createdBy,
        },
        transaction,
      );

      return journalTransaction;
    });
  }

  /**
   * Unstake: trả tài sản đã khoá về lại cho client, đóng journal.
   *
   * `stakedAmount` được lấy từ CHÍNH request (không dò ngược từ số dư hiện
   * tại của custodyBook): nếu unstake bị gọi lại 2 lần (duplicate event),
   * lần gọi lại phải tính ra ĐÚNG posting cũ (idempotencyToken cũ + số tiền
   * cũ) để BookPostingRepository nhận diện là trùng và bỏ qua — nếu tính lại
   * amount dựa trên số dư custodyBook TẠI THỜI ĐIỂM GỌI (như bản nháp cũ),
   * lần gọi lại (sau khi custody đã về 0 từ lần đầu) sẽ tính ra amount = 0,
   * âm thầm sinh ra 1 posting "0 đồng" khác token — vừa sai vừa rác dữ liệu.
   */
  async unstake(
    journalTransactionId: number,
    stakedAmount: string,
    updatedBy?: number | null,
    businessPostDateTime: Date = new Date(),
  ): Promise<JournalTransaction> {
    return this.unitOfWork.execute(async (transaction) => {
      const journalTransaction = await this.journalTransactionRepository.updateJournalTransaction(
        {
          journalTransactionId,
          journalTransactionState: JOURNAL_TRANSACTION_STATE.COMPLETED,
          targetTransactionStateId: TRANSACTION_STATE.CONFIRMED.id,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
          updatedBy,
          completeJournal: true,
        },
        transaction,
      );

      // idempotencyToken có thể null (JournalTransaction cho phép tạo không kèm
      // idempotency token — xem getOrCreateJournalTransaction) — rơi về id journal
      // làm khoá gốc để build token cho posting vẫn deterministic theo journal này.
      const baseIdempotencyToken = journalTransaction.idempotencyToken ?? `journal-${journalTransaction.id}`;

      // Tìm đúng 2 book của lần stake này một cách chắc chắn (không phụ
      // thuộc field "name" tự do như bản nháp cũ) bằng cách lấy qua
      // BookPosting đã tạo ở bước create() — mỗi JournalTransaction có đúng
      // các BookPosting gắn với journalTransactionId của nó, và mỗi
      // BookPosting trỏ thẳng tới Book qua bookId (khoá ngoại thật, không
      // phải chuỗi tên suy diễn).
      const custodyBook = await this.findBookByStakePosting(journalTransactionId, BOOK_PURPOSE.CUSTODY_CONTROL_ACCOUNT.id, transaction);
      const clientBookResolved = await this.findBookByStakePosting(journalTransactionId, BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id, transaction);

      await this.bookRepository.lockBooksInOrder([clientBookResolved.id, custodyBook.id], transaction);

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: custodyBook.id,
          journalTransactionId: journalTransaction.id,
          amount: `-${stakedAmount}`,
          assetTypeId: custodyBook.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: baseIdempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.STAKE,
            transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
            bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
            legIndex: 1,
          }),
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: updatedBy,
          businessPostDateTime,
        },
        transaction,
      );

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: clientBookResolved.id,
          journalTransactionId: journalTransaction.id,
          amount: stakedAmount,
          assetTypeId: clientBookResolved.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: baseIdempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.STAKE,
            transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
            bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
            legIndex: 2,
          }),
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: updatedBy,
          businessPostDateTime,
        },
        transaction,
      );

      return journalTransaction;
    });
  }

  /**
   * Lấy đúng book đã tham gia vào lần stake này (theo journalTransactionId +
   * bookPurposeId), thông qua BookPosting — thay vì suy đoán qua tên chuỗi.
   */
  private async findBookByStakePosting(
    journalTransactionId: number,
    bookPurposeId: number,
    transaction: import('sequelize').Transaction,
  ): Promise<Book> {
    const posting = await BookPosting.findOne({
      where: { journalTransactionId },
      include: [{ association: 'book', required: true, where: { bookPurposeId } }],
      transaction,
    });

    if (!posting || !posting.book) {
      throw new NotFoundError('Book (stake leg)', `${journalTransactionId}:${bookPurposeId}`);
    }

    return posting.book;
  }
}
