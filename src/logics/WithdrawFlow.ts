import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { Book, JournalTransaction } from '../models';
import { UnitOfWork } from '../common/UnitOfWork';
import { BookRepository, BookPostingRepository, JournalTransactionRepository } from '../repositories';
import { BOOK_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE, HISTORY_EVENT_TYPE, JOURNAL_TRANSACTION_STATE, BOOK_POSTING_PURPOSE } from '../constants';
import { WithdrawRejectedError, InvalidStateTransitionError } from '../common/errors';
import { BaseTransactionRequest, resolveAmountAsset, resolveFeeAsset } from './types';
import { buildPostingIdempotencyToken } from './idempotency';
import { findBookByJournalAndPurpose } from './bookLookup';

export type WithdrawKind = 'EXTERNAL' | 'INTERNAL';

export interface WithdrawRequest extends BaseTransactionRequest {
  fee: string;
  /**
   * source / destination account phải được mô tả rõ ràng để biết đây là
   * withdrawal nội bộ hay ngoại bộ. `accountId` vẫn giữ làm alias tương thích,
   * nhưng trong code mới nên ưu tiên `fromAccountId`/`toAccountId`.
   */
  fromAccountId?: number | null;
  toAccountId?: number | null;
  /**
   * Mô tả rõ asset chịu phí. Ví dụ: chuyển 100 USDT nhưng phí gas trả bằng ETH.
   * Nếu không truyền, feeAsset sẽ mặc định bằng amountAsset, phù hợp case phổ biến.
   */
  feeAsset?: import('./types').AssetBookDescriptor;
  feeAssetId?: number;
  feeAssetTypeId?: number;
  feeAssetTicker?: string;
  /**
   * EXTERNAL (mặc định): rút ra ngoài hệ thống qua blockchain thật — đi đủ
   *   AUTHORIZING -> AUTHORIZED -> SENT -> CONFIRMING -> CONFIRMED.
   * INTERNAL: chuyển nội bộ / không có tx blockchain thật — KHÔNG có
   *   SENT/CONFIRMING, chỉ: AUTHORIZING -> AUTHORIZED -> CONFIRMED.
   */
  kind?: WithdrawKind;
}

export type WithdrawTargetState = 'AUTHORIZED' | 'SENT' | 'CONFIRMING' | 'CONFIRMED';

/**
 * Chuỗi state HỢP LỆ cho từng kind — dùng làm `expectedStateSequence` khi
 * gọi JournalTransactionRepository.updateJournalTransaction. advance() BẮT
 * BUỘC đi đúng thứ tự trong mảng này; sai -> cả journal bị CANCELLED ngay.
 */
const WITHDRAW_STATE_SEQUENCE: Record<WithdrawKind, number[]> = {
  EXTERNAL: [
    TRANSACTION_STATE.AUTHORIZING.id,
    TRANSACTION_STATE.AUTHORIZED.id,
    TRANSACTION_STATE.SENT.id,
    TRANSACTION_STATE.CONFIRMING.id,
    TRANSACTION_STATE.CONFIRMED.id,
  ],
  INTERNAL: [TRANSACTION_STATE.AUTHORIZING.id, TRANSACTION_STATE.AUTHORIZED.id, TRANSACTION_STATE.CONFIRMED.id],
};

/**
 * Withdraw lifecycle (kind EXTERNAL — đủ 5 state):
 *   AUTHORIZING -> AUTHORIZED -> SENT -> CONFIRMING -> CONFIRMED
 *
 * Sổ sách (double-entry qua TỪNG state, không chỉ 1 lần lúc tạo):
 *
 *   create() — bước AUTHORIZING (tiền RỜI KHỎI CLIENT):
 *     CUSTODY_ASSET_ACCOUNT(CONFIRMED)      -amount -> EXTERNAL_ACCOUNT(AUTHORIZING)          +amount
 *     CUSTODY_ASSET_ACCOUNT(CONFIRMED)      -fee    -> CUSTODY_ASSET_ACCOUNT(AUTHORIZING) +fee
 *     = 4 posting (2 amount, 2 fee)
 *
 *   advance() — MỖI lần chuyển sang state kế tiếp, số dư "đi qua" bucket đó:
 *     EXTERNAL_ACCOUNT(state cũ)           -amount -> EXTERNAL_ACCOUNT(state mới)            +amount
 *     CUSTODY_ASSET_ACCOUNT(state cũ) -fee    -> CUSTODY_ASSET_ACCOUNT(state mới)   +fee
 *     = 4 posting mỗi lần chuyển × 4 lần chuyển (AUTHORIZING->AUTHORIZED->SENT->CONFIRMING->
 *       CONFIRMED) = 16 posting (8 amount, 8 fee)
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
      const { clientAmountBook, clientFeeBook } = await this.assertSufficientBalanceOrThrow(request, transaction);

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

      const { book: internalbook } = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
          clientId: amountAsset.clientId,
          accountId: amountAsset.accountId,
          assetId: amountAsset.assetId,
          assetTypeId: amountAsset.assetTypeId,
          assetTicker: amountAsset.assetTicker,
          walletTypeId: amountAsset.walletTypeId,
          address: amountAsset.address,
          createdBy: request.createdBy,
        },
        transaction,
      );

      const { book: internalbook1 } = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
          clientId: amountAsset.clientId,
          accountId: amountAsset.accountId,
          assetId: amountAsset.assetId,
          assetTypeId: amountAsset.assetTypeId,
          assetTicker: amountAsset.assetTicker,
          walletTypeId: amountAsset.walletTypeId,
          address: amountAsset.address,
          createdBy: request.createdBy,
        },
        transaction,
      );
      const { book: custodyFeeBook } = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
          clientId: feeAsset.clientId,
          accountId: feeAsset.accountId,
          assetId: feeAsset.assetId,
          assetTypeId: feeAsset.assetTypeId,
          assetTicker: feeAsset.assetTicker,
          walletTypeId: feeAsset.walletTypeId,
          address: feeAsset.address,
          createdBy: request.createdBy,
        },
        transaction,
      );

      const { book: custodyFeeBook1 } = await this.bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
          clientId: feeAsset.clientId,
          accountId: feeAsset.accountId,
          assetId: feeAsset.assetId,
          assetTypeId: feeAsset.assetTypeId,
          assetTicker: feeAsset.assetTicker,
          walletTypeId: feeAsset.walletTypeId,
          address: feeAsset.address,
          createdBy: request.createdBy,
        },
        transaction,
      );

      // Lock TẤT CẢ book liên quan theo thứ tự id tăng dần TRƯỚC khi post —
      // tránh deadlock với 1 withdraw/deposit khác chạy song song đụng đúng
      // các book này theo thứ tự ngược lại. createBookPosting cũng tự lock
      // lại từng book của chính nó — Postgres cho phép 1 transaction lock
      // lại row nó đã tự khoá, không tự deadlock với chính mình.
      const bookIdsToLock = new Set([clientAmountBook.id, clientFeeBook.id, internalbook.id, custodyFeeBook.id]);
      await this.bookRepository.lockBooksInOrder([...bookIdsToLock], transaction);

      // 2) Bước AUTHORIZING: tiền rời khỏi client, vào bucket AUTHORIZING.
      await this.bookPostingRepository.createBookPosting(
        {
          bookId: clientAmountBook.id,
          journalTransactionId: journalTransaction.id,
          amount: `-${request.amount}`,
          assetTypeId: amountAsset.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: request.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
            transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
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
          bookId: internalbook1.id,
          journalTransactionId: journalTransaction.id,
          amount: request.amount,
          assetTypeId: amountAsset.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: request.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
            transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
            bookPostingPurposeId: BOOK_POSTING_PURPOSE.AMOUNT,
            legIndex: 2,
          }),
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      await this.bookPostingRepository.createBookPosting(
        {
          bookId: clientFeeBook.id,
          journalTransactionId: journalTransaction.id,
          amount: `-${request.fee}`,
          assetTypeId: feeAsset.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,
          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: request.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
            transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
            bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,
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
          bookId: custodyFeeBook1.id,
          journalTransactionId: journalTransaction.id,
          amount: request.fee,
          assetTypeId: feeAsset.assetTypeId,
          bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,
          idempotencyToken: buildPostingIdempotencyToken({
            idempotencyToken: request.idempotencyToken,
            transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
            transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
            bookPostingPurposeId: BOOK_POSTING_PURPOSE.FEE,
            legIndex: 2,
          }),
          historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
          createdBy: request.createdBy,
          businessPostDateTime: request.businessPostDateTime,
        },
        transaction,
      );

      return journalTransaction;
    });
  }

  /**
   * Kiểm tra số dư client TRƯỚC khi tạo bất kỳ thứ gì. Lock book(s) ngay tại
   * đây (không phải chỉ đọc rồi check) để tránh race: 2 withdraw cùng
   * client bắn đồng thời không được phép cùng pass qua check rồi cùng rút —
   * lock đảm bảo cái sau phải đợi cái trước commit/rollback xong mới được
   * đọc số dư mới nhất.
   *
   * amount và fee CÓ THỂ khác asset type (vd token dùng ETH làm phí gas) —
   * nếu vậy kiểm tra 2 vế ĐỘC LẬP và báo đủ CẢ HAI vế thiếu (nếu có) trong 1
   * lỗi duy nhất, thay vì chỉ báo vế đầu tiên rồi bắt client thử lại nhiều lần.
   */
  private async assertSufficientBalanceOrThrow(
    request: WithdrawRequest,
    transaction: Transaction,
  ): Promise<{ clientAmountBook: Book; clientFeeBook: Book }> {
    const amountAsset = resolveAmountAsset(request);
    const feeAsset = resolveFeeAsset(request);
    const sameAsset = feeAsset.assetTypeId === amountAsset.assetTypeId && feeAsset.assetId === amountAsset.assetId;

    const { book: clientAmountBookUnlocked } = await this.bookRepository.getOrCreateBook(
      {
        name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
        bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
        clientId: amountAsset.clientId,
        accountId: amountAsset.accountId,
        assetId: amountAsset.assetId,
        assetTypeId: amountAsset.assetTypeId,
        assetTicker: amountAsset.assetTicker,
        walletTypeId: amountAsset.walletTypeId,
        address: amountAsset.address,
        createdBy: request.createdBy,
      },
      transaction,
    );

    if (sameAsset) {
      const clientAmountBook = await this.bookRepository.lockBookById(clientAmountBookUnlocked.id, transaction);
      const needed = BigInt(request.amount) + BigInt(request.fee);

      if (BigInt(clientAmountBook.amount) < needed) {
        throw new WithdrawRejectedError([
          `assetType ${amountAsset.assetTypeId}: cần ${needed.toString()} (amount ${request.amount} + fee ${request.fee}), hiện có ${clientAmountBook.amount}`,
        ]);
      }

      return { clientAmountBook, clientFeeBook: clientAmountBook };
    }

    const { book: clientFeeBookUnlocked } = await this.bookRepository.getOrCreateBook(
      {
        name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
        bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
        clientId: feeAsset.clientId,
        accountId: feeAsset.accountId,
        assetId: feeAsset.assetId,
        assetTypeId: feeAsset.assetTypeId,
        assetTicker: feeAsset.assetTicker,
        walletTypeId: feeAsset.walletTypeId,
        address: feeAsset.address,
        createdBy: request.createdBy,
      },
      transaction,
    );

    const locked = await this.bookRepository.lockBooksInOrder([clientAmountBookUnlocked.id, clientFeeBookUnlocked.id], transaction);
    const clientAmountBook = locked.get(clientAmountBookUnlocked.id)!;
    const clientFeeBook = locked.get(clientFeeBookUnlocked.id)!;

    const shortfalls: string[] = [];
    if (BigInt(clientAmountBook.amount) < BigInt(request.amount)) {
      shortfalls.push(`amount (assetType ${amountAsset.assetTypeId}): cần ${request.amount}, hiện có ${clientAmountBook.amount}`);
    }
    if (BigInt(clientFeeBook.amount) < BigInt(request.fee)) {
      shortfalls.push(`fee (assetType ${feeAsset.assetTypeId}): cần ${request.fee}, hiện có ${clientFeeBook.amount}`);
    }

    if (shortfalls.length > 0) {
      throw new WithdrawRejectedError(shortfalls);
    }

    return { clientAmountBook, clientFeeBook };
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
        await this.refundFromLastValidBucket(journalTransaction, updatedBy, transaction);
        throw new InvalidStateTransitionError(journalTransaction.id, journalTransaction.transactionStateId, targetStateId);
      }

      // Happy-path theo flow bạn muốn:
      // - amount: custody state cũ -> custody state mới, cho đến bucket
      //   CUSTODY_ASSET_ACCOUNT(CONFIRMING)
      // - sau đó rời custody sang EXTERNAL_ACCOUNT(null) ở bước cuối
      // - fee: luôn ở lại trong custody buckets theo từng state, không bay ra external
      // - khi targetState === CONFIRMED, chỉ đánh dấu journal complete; phần move
      //   cuối cùng đã được thực hiện ở state CONFIRMING trước đó / khi rời khỏi
      //   custody cuối cùng.
      const targetIndex = sequence.indexOf(targetStateId);
      const fromStateId = sequence[targetIndex - 1];

      if (targetState === 'CONFIRMED') {
        const confirmingStateId = TRANSACTION_STATE.CONFIRMING.id;
        await this.moveBucket(
          journalTransaction,
          BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
          BOOK_POSTING_PURPOSE.AMOUNT,
          confirmingStateId,
          TRANSACTION_STATE.NOT_APPLICABLE.id,
          updatedBy,
          transaction,
        );
        await this.moveBucket(
          journalTransaction,
          BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
          BOOK_POSTING_PURPOSE.FEE,
          fromStateId,
          TRANSACTION_STATE.NOT_APPLICABLE.id,
          updatedBy,
          transaction,
        );
        return journalTransaction;
      }

      await this.moveBucket(
        journalTransaction,
        BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        BOOK_POSTING_PURPOSE.AMOUNT,
        fromStateId,
        targetStateId,
        updatedBy,
        transaction,
      );
      await this.moveBucket(
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

  /**
   * Di chuyển TOÀN BỘ số dư hiện có của 1 book "control/pass-through" (đại
   * diện qua bookPurposeId) từ bucket state CŨ sang bucket state MỚI — 2
   * posting (debit bucket cũ, credit bucket mới). Dùng amount = số dư THỰC
   * TẾ đang có ở bucket cũ (không dùng lại request.amount gốc) để tổng quát
   * đúng ngay cả khi có nhiều lần cộng dồn vào bucket đó.
   */
  private async moveBucket(
    journalTransaction: JournalTransaction,
    fromBookPurposeId: number,
    toBookPurposeId: number,
    bookPostingPurposeId: number,
    fromStateId: number,
    toStateId: number | null,
    updatedBy: number | null | undefined,
    transaction: Transaction,
  ): Promise<void> {
    const fromBook = await findBookByJournalAndPurpose(journalTransaction.id, fromBookPurposeId, transaction, fromStateId, bookPostingPurposeId);

    const { book: toBookUnlocked } = await this.bookRepository.getOrCreateBook(
      {
        name: toBookPurposeId === BOOK_PURPOSE.EXTERNAL_ACCOUNT.id ? BOOK_PURPOSE.EXTERNAL_ACCOUNT.code : (fromBook.name ?? String(toBookPurposeId)),
        bookPurposeId: toBookPurposeId,
        transactionStateId: toStateId,
        clientId: fromBook.clientId,
        accountId: fromBook.accountId,
        assetId: fromBook.assetId,
        assetTypeId: fromBook.assetTypeId,
        assetTicker: fromBook.assetTicker,
        walletTypeId: fromBook.walletTypeId,
        address: fromBook.address,
        createdBy: updatedBy ?? null,
      },
      transaction,
    );

    const locked = await this.bookRepository.lockBooksInOrder([fromBook.id, toBookUnlocked.id], transaction);
    const lockedFromBook = locked.get(fromBook.id)!;
    const lockedToBook = locked.get(toBookUnlocked.id)!;

    const moveAmount = lockedFromBook.amount;
    const baseIdempotencyToken = journalTransaction.idempotencyToken ?? `journal-${journalTransaction.id}`;

    await this.bookPostingRepository.createBookPosting(
      {
        bookId: lockedFromBook.id,
        journalTransactionId: journalTransaction.id,
        amount: `-${moveAmount}`,
        assetTypeId: lockedFromBook.assetTypeId,
        bookPostingPurposeId,
        idempotencyToken: buildPostingIdempotencyToken({
          idempotencyToken: baseIdempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
          transactionStateId: toStateId,
          bookPostingPurposeId,
          legIndex: 1,
        }),
        historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
        createdBy: updatedBy,
        businessPostDateTime: new Date(),
      },
      transaction,
    );

    await this.bookPostingRepository.createBookPosting(
      {
        bookId: lockedToBook.id,
        journalTransactionId: journalTransaction.id,
        amount: moveAmount,
        assetTypeId: lockedFromBook.assetTypeId,
        bookPostingPurposeId,
        idempotencyToken: buildPostingIdempotencyToken({
          idempotencyToken: baseIdempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
          transactionStateId: toStateId,
          bookPostingPurposeId,
          legIndex: 2,
        }),
        historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
        createdBy: updatedBy,
        businessPostDateTime: new Date(),
      },
      transaction,
    );
  }

  /**
   * Hoàn tiền lại cho client khi 1 advance() bị REJECT vì sai thứ tự state.
   * Tìm book EXTERNAL_ACCOUNT (amount) + CUSTODY_ASSET_ACCOUNT (fee) tại
   * ĐÚNG bucket cuối cùng còn hợp lệ (journalTransaction.transactionStateId —
   * KHÔNG bị updateJournalTransaction ghi đè khi reject, xem repository),
   * rồi chuyển thẳng số dư đang treo ở đó về lại CUSTODY_ASSET_ACCOUNT(CONFIRMED).
   *
   * Idempotent tự nhiên: hàm này chỉ được advance() gọi ĐÚNG 1 LẦN cho mỗi
   * journal (lần rejection ĐẦU TIÊN) — mọi lệnh advance() sai thứ tự gọi lại
   * SAU đó đều bị chặn sớm bởi TERMINAL_STATES (journal đã CANCELLED) và trả
   * về REPLAYED_NOOP trước khi tới được nhánh gọi hàm này.
   */
  private async refundFromLastValidBucket(
    journalTransaction: JournalTransaction,
    updatedBy: number | null | undefined,
    transaction: Transaction,
  ): Promise<void> {
    const lastValidStateId = journalTransaction.transactionStateId;

    if (lastValidStateId == null) {
      // Không nên xảy ra trong thực tế (create() luôn set AUTHORIZING ngay
      // từ đầu) — không có bucket nào để hoàn thì không có gì để làm.
      return;
    }

    // Hoàn thẳng amount từ EXTERNAL_ACCOUNT(lastValidStateId) về
    // CUSTODY_ASSET_ACCOUNT(CONFIRMED) — dùng lại đúng cơ chế moveBucket()
    // nhưng đích là bucket CUSTODY_ASSET_ACCOUNT thay vì tiếp tục chuỗi state
    // control/pass-through, nên viết trực tiếp thay vì gọi moveBucket() (vốn
    // giữ nguyên bookPurposeId 2 đầu).
    await this.refundBucketToClient(
      journalTransaction,
      BOOK_PURPOSE.EXTERNAL_ACCOUNT.id,
      BOOK_POSTING_PURPOSE.AMOUNT,
      lastValidStateId,
      updatedBy,
      transaction,
    );
    await this.refundBucketToClient(
      journalTransaction,
      BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
      BOOK_POSTING_PURPOSE.FEE,
      lastValidStateId,
      updatedBy,
      transaction,
    );
  }

  private async refundBucketToClient(
    journalTransaction: JournalTransaction,
    fromBookPurposeId: number,
    bookPostingPurposeId: number,
    fromStateId: number,
    updatedBy: number | null | undefined,
    transaction: Transaction,
  ): Promise<void> {
    const fromBook = await findBookByJournalAndPurpose(journalTransaction.id, fromBookPurposeId, transaction, fromStateId, bookPostingPurposeId);

    const { book: clientBookUnlocked } = await this.bookRepository.getOrCreateBook(
      {
        name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
        bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
        clientId: fromBook.clientId,
        accountId: fromBook.accountId,
        assetId: fromBook.assetId,
        assetTypeId: fromBook.assetTypeId,
        assetTicker: fromBook.assetTicker,
        walletTypeId: fromBook.walletTypeId,
        address: fromBook.address,
        createdBy: updatedBy ?? null,
      },
      transaction,
    );

    const locked = await this.bookRepository.lockBooksInOrder([fromBook.id, clientBookUnlocked.id], transaction);
    const lockedFromBook = locked.get(fromBook.id)!;
    const clientBook = locked.get(clientBookUnlocked.id)!;

    const refundAmount = lockedFromBook.amount;
    const baseIdempotencyToken = journalTransaction.idempotencyToken ?? `journal-${journalTransaction.id}`;
    // legIndex 900+ dành riêng cho nhánh hoàn tiền — không bao giờ đụng token
    // của các bước advance bình thường (legIndex 1/2).

    await this.bookPostingRepository.createBookPosting(
      {
        bookId: lockedFromBook.id,
        journalTransactionId: journalTransaction.id,
        amount: `-${refundAmount}`,
        assetTypeId: lockedFromBook.assetTypeId,
        bookPostingPurposeId,
        idempotencyToken: buildPostingIdempotencyToken({
          idempotencyToken: baseIdempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
          transactionStateId: fromStateId,
          bookPostingPurposeId,
          legIndex: 901,
        }),
        historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
        createdBy: updatedBy,
        businessPostDateTime: new Date(),
      },
      transaction,
    );

    await this.bookPostingRepository.createBookPosting(
      {
        bookId: clientBook.id,
        journalTransactionId: journalTransaction.id,
        amount: refundAmount,
        assetTypeId: lockedFromBook.assetTypeId,
        bookPostingPurposeId,
        idempotencyToken: buildPostingIdempotencyToken({
          idempotencyToken: baseIdempotencyToken,
          transactionTypeId: TRANSACTION_TYPE.WITHDRAWAL,
          transactionStateId: fromStateId,
          bookPostingPurposeId,
          legIndex: 902,
        }),
        historyTransactionTypeId: HISTORY_EVENT_TYPE.POSTING_APPLIED,
        createdBy: updatedBy,
        businessPostDateTime: new Date(),
      },
      transaction,
    );
  }
}
