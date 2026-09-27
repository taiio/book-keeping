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
import { postDoubleEntry, resolveBaseIdempotencyToken } from '../shared/doubleEntryPosting';
import { findBookByJournalAndPurpose } from '../shared/bookLookup';

export interface StakeRequest extends BaseTransactionRequest {
  /**
   * Stake không chỉ là "trừ từ client account" mà còn cần xác định rõ nơi tài
   * sản được khóa. Trong design mới, `accountId` là nguồn tài sản và `custodyAccountId`
   * là đối tượng nhận khóa (nếu cần tách riêng).
   */
  custodyAccountId?: number | null;
}

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

  private assetOf(request: StakeRequest): AssetBookDescriptor {
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

      const asset = this.assetOf(request);

      const clientBook = await openBook(
        this.bookRepository,
        {
          code: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
          asset,
          createdBy: request.createdBy,
        },
        transaction,
      );
      const custodyBook = await openBook(
        this.bookRepository,
        {
          code: BOOK_PURPOSE.CUSTODY_CONTROL_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_CONTROL_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
          asset,
          createdBy: request.createdBy,
        },
        transaction,
      );

      // Lock cả 2 book theo thứ tự id tăng dần trước khi post — tránh
      // deadlock với 1 unstake khác đang chạy song song trên đúng 2 book này.
      await this.bookRepository.lockBooksInOrder([clientBook.id, custodyBook.id], transaction);

      await postDoubleEntry(
        this.bookPostingRepository,
        {
          journalTransactionId: journalTransaction.id,
          fromBook: clientBook,
          toBook: custodyBook,
          amount: request.amount,
          assetTypeId: request.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
          idempotencyToken: request.idempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.STAKE,
          tokenStateId: TRANSACTION_STATE.AUTHORIZED.id,
        },
        transaction,
      );

      // Đánh dấu đã khoá tài sản xong (audit trail — journal_transaction_state
      // vẫn ở ACTIVE, chưa COMPLETED, vì vòng đời còn tiếp tục tới unstake).
      // Stake không dùng expectedStateSequence (FSM lỏng, chỉ 2 bước) nên
      // outcome ở đây luôn là 'APPLIED' — không cần xử lý REJECTED.
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
   * amount dựa trên số dư custodyBook TẠI THỜI ĐIỂM GỌI, lần gọi lại (sau
   * khi custody đã về 0 từ lần đầu) sẽ tính ra amount = 0, âm thầm sinh ra
   * 1 posting "0 đồng" khác token — vừa sai vừa rác dữ liệu.
   */
  async unstake(
    journalTransactionId: number,
    stakedAmount: string,
    updatedBy?: number | null,
    businessPostDateTime: Date = new Date(),
  ): Promise<JournalTransaction> {
    return this.unitOfWork.execute(async (transaction) => {
      const { journalTransaction } = await this.journalTransactionRepository.updateJournalTransaction(
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

      const baseIdempotencyToken = resolveBaseIdempotencyToken(journalTransaction);

      // Tìm đúng 2 book của lần stake này một cách chắc chắn (không phụ
      // thuộc field "name" tự do) bằng cách lấy qua BookPosting đã tạo ở
      // bước create() — mỗi BookPosting trỏ thẳng tới Book qua bookId.
      const custodyBook = await findBookByJournalAndPurpose(journalTransactionId, BOOK_PURPOSE.CUSTODY_CONTROL_ACCOUNT.id, transaction);
      const clientBook = await findBookByJournalAndPurpose(journalTransactionId, BOOK_PURPOSE.CLIENT_ASSET_ACCOUNT.id, transaction);

      await this.bookRepository.lockBooksInOrder([clientBook.id, custodyBook.id], transaction);

      await postDoubleEntry(
        this.bookPostingRepository,
        {
          journalTransactionId: journalTransaction.id,
          fromBook: custodyBook,
          toBook: clientBook,
          amount: stakedAmount,
          assetTypeId: custodyBook.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: updatedBy,
          businessPostDateTime,
          idempotencyToken: baseIdempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.STAKE,
          tokenStateId: TRANSACTION_STATE.CONFIRMED.id,
        },
        transaction,
      );

      return journalTransaction;
    });
  }
}
