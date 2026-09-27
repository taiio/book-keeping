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
import { InvalidStateTransitionError } from '../../common/errors';
import { resolveAmountAsset, resolveFeeAsset } from '../shared/types';
import { openBook } from '../shared/bookAccess';
import { postDoubleEntry } from '../shared/doubleEntryPosting';
import { assertSufficientBalanceOrThrow } from './balanceCheck';
import { moveBucket, refundFromLastValidBucket } from './bucketMovement';
import { WITHDRAW_STATE_SEQUENCE } from './withdrawStateSequence';
import { WithdrawKind, WithdrawRequest, WithdrawTargetState } from './types';

export type { WithdrawKind, WithdrawRequest, WithdrawTargetState } from './types';

/**
 * Withdraw lifecycle (kind EXTERNAL — đủ 5 state):
 *   AUTHORIZING -> AUTHORIZED -> SENT -> CONFIRMING -> CONFIRMED
 *
 * Sổ sách (double-entry qua TỪNG state, không chỉ 1 lần lúc tạo):
 *
 *   create() — bước AUTHORIZING (tiền RỜI KHỎI CLIENT):
 *     CUSTODY_ASSET_ACCOUNT(CONFIRMED) -amount -> CUSTODY_ASSET_ACCOUNT(AUTHORIZING) +amount
 *     CUSTODY_ASSET_ACCOUNT(CONFIRMED) -fee    -> CUSTODY_ASSET_ACCOUNT(AUTHORIZING) +fee
 *     = 4 posting (2 amount, 2 fee)
 *
 *   advance() — MỖI lần chuyển sang state kế tiếp, số dư "đi qua" bucket đó
 *   (xem bucketMovement.ts#moveBucket) = 4 posting mỗi lần chuyển × 4 lần
 *   chuyển (AUTHORIZING->AUTHORIZED->SENT->CONFIRMING->CONFIRMED) = 16 posting.
 *
 *   TỔNG cho 1 withdraw EXTERNAL đi hết vòng đời: 4 + 16 = 20 posting,
 *   đúng 10 posting "amount" + 10 posting "fee".
 *
 * kind INTERNAL bỏ qua SENT/CONFIRMING nên tổng chỉ còn 4 + 2×4 = 12 posting
 * (6 amount + 6 fee) — cùng 1 cơ chế, chỉ khác chuỗi state.
 */
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
      // 1) PRE-CHECK số dư TRƯỚC khi tạo bất kỳ journal/posting nào — nếu
      // thiếu (amount, fee, hoặc cả 2 — có thể khác asset type), REJECT
      // NGAY, không tạo journal, và báo rõ đủ mọi vế bị thiếu trong 1 lần.
      const { clientAmountBook, clientFeeBook } = await assertSufficientBalanceOrThrow(this.bookRepository, request, transaction);

      const { journalTransaction } = await this.journalTransactionRepository.getOrCreateJournalTransaction(
        {
          idempotencyToken: request.idempotencyToken,
          uuidToken: request.uuidToken,
          transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
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

      const amountAsset = resolveAmountAsset(request);
      const feeAsset = resolveFeeAsset(request);

      // Chỉ cần mở bucket AUTHORIZING mới — bucket CONFIRMED (nguồn tiền)
      // đã được assertSufficientBalanceOrThrow mở + lock sẵn ở trên
      // (clientAmountBook/clientFeeBook), không cần getOrCreateBook lại.
      const authorizingAmountBook = await openBook(
        this.bookRepository,
        {
          code: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
          asset: amountAsset,
          createdBy: request.createdBy,
        },
        transaction,
      );
      const authorizingFeeBook = await openBook(
        this.bookRepository,
        {
          code: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
          asset: feeAsset,
          createdBy: request.createdBy,
        },
        transaction,
      );

      // Lock TẤT CẢ book liên quan theo thứ tự id tăng dần TRƯỚC khi post —
      // tránh deadlock với 1 withdraw/deposit khác chạy song song đụng đúng
      // các book này theo thứ tự ngược lại. createBookPosting cũng tự lock
      // lại từng book của chính nó — Postgres cho phép 1 transaction lock
      // lại row nó đã tự khoá, không tự deadlock với chính mình.
      const bookIdsToLock = new Set([clientAmountBook.id, clientFeeBook.id, authorizingAmountBook.id, authorizingFeeBook.id]);
      await this.bookRepository.lockBooksInOrder([...bookIdsToLock], transaction);

      // 2) Bước AUTHORIZING: tiền rời khỏi client, vào bucket AUTHORIZING.
      await postDoubleEntry(
        this.bookPostingRepository,
        {
          journalTransactionId: journalTransaction.id,
          fromBook: clientAmountBook,
          toBook: authorizingAmountBook,
          amount: request.amount,
          assetTypeId: amountAsset.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
          idempotencyToken: request.idempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
          tokenStateId: TRANSACTION_STATE.AUTHORIZING.id,
        },
        transaction,
      );

      await postDoubleEntry(
        this.bookPostingRepository,
        {
          journalTransactionId: journalTransaction.id,
          fromBook: clientFeeBook,
          toBook: authorizingFeeBook,
          amount: request.fee,
          assetTypeId: feeAsset.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
          idempotencyToken: request.idempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
          tokenStateId: TRANSACTION_STATE.AUTHORIZING.id,
        },
        transaction,
      );

      return journalTransaction;
    });
  }

  /**
   * Advance sang state kế tiếp. BẮT BUỘC đúng thứ tự trong
   * WITHDRAW_STATE_SEQUENCE[kind] — bỏ bước hoặc lộn xộn sẽ làm HUỶ TOÀN BỘ
   * journal (CANCELLED_OR_EXPIRED) và tự động hoàn tiền lại cho client từ
   * bucket cuối cùng còn hợp lệ, rồi throw InvalidStateTransitionError.
   *
   * Idempotent với duplicate/late event nhờ outcome REPLAYED_NOOP (xem
   * JournalTransactionRepository.updateJournalTransaction).
   */
  async advance(
    journalTransactionId: number,
    targetState: WithdrawTargetState,
    kind: WithdrawKind = 'EXTERNAL',
    transactionHash?: string | null,
    updatedBy?: number | null,
  ): Promise<JournalTransaction> {
    return this.unitOfWork.execute(async (transaction) => {
      const sequence = WITHDRAW_STATE_SEQUENCE[kind];
      const targetStateId = TRANSACTION_STATE[targetState].id;

      const { journalTransaction, outcome } = await this.journalTransactionRepository.updateJournalTransaction(
        {
          journalTransactionId,
          journalTransactionState: targetState === 'CONFIRMED' ? JOURNAL_TRANSACTION_STATE.COMPLETED : JOURNAL_TRANSACTION_STATE.ACTIVE,
          targetTransactionStateId: targetStateId,
          expectedStateSequence: sequence,
          historyTransactionTypeId: HISTORY_EVENT_TYPE.STATE_ADVANCED,
          transactionHash: transactionHash ?? undefined,
          updatedBy,
          completeJournal: targetState === 'CONFIRMED',
        },
        transaction,
      );

      if (outcome === 'REPLAYED_NOOP') {
        return journalTransaction;
      }

      if (outcome === 'REJECTED_INVALID_TRANSITION') {
        await refundFromLastValidBucket(
          { bookRepository: this.bookRepository, bookPostingRepository: this.bookPostingRepository },
          journalTransaction,
          updatedBy,
          transaction,
        );
        throw new InvalidStateTransitionError(journalTransaction.id, journalTransaction.transactionStateId, targetStateId);
      }

      // Happy-path:
      // - amount: custody state cũ -> custody state mới, cho đến bucket
      //   CUSTODY_ASSET_ACCOUNT(CONFIRMING), rồi rời custody sang
      //   EXTERNAL_ACCOUNT(null) ở bước cuối (targetState === CONFIRMED).
      // - fee: luôn ở lại trong custody buckets theo từng state, không bay ra external.
      const targetIndex = sequence.indexOf(targetStateId);
      const fromStateId = sequence[targetIndex - 1];
      const deps = { bookRepository: this.bookRepository, bookPostingRepository: this.bookPostingRepository };

      if (targetState === 'CONFIRMED') {
        const confirmingStateId = TRANSACTION_STATE.CONFIRMING.id;
        await moveBucket(
          deps,
          journalTransaction,
          BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
          BOOK_POSTING_PURPOSE.AMOUNT,
          confirmingStateId,
          null,
          updatedBy,
          transaction,
        );
        await moveBucket(
          deps,
          journalTransaction,
          BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
          BOOK_POSTING_PURPOSE.FEE,
          fromStateId,
          targetStateId,
          updatedBy,
          transaction,
        );
        return journalTransaction;
      }

      await moveBucket(
        deps,
        journalTransaction,
        BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        BOOK_POSTING_PURPOSE.AMOUNT,
        fromStateId,
        targetStateId,
        updatedBy,
        transaction,
      );
      await moveBucket(
        deps,
        journalTransaction,
        BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        BOOK_POSTING_PURPOSE.FEE,
        fromStateId,
        targetStateId,
        updatedBy,
        transaction,
      );

      return journalTransaction;
    });
  }
}
