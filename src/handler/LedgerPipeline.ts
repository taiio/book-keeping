import { Transaction as SequelizeTransaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { BOOK_POSTING_PURPOSE, TRANSACTION_STATE } from '../constants';
import {
  collectDebitAndFeeMovements,
  custodyBookParams,
  depositMovementKey,
  externalBookParams,
  movementKey,
  negateQuantity,
  postingTokens,
} from '../helpers';
import {
  ApplyMovementParams,
  GetOrCreateJournalTransactionParams,
  GetOrCreateJournalTransactionResult,
  LedgerOperationParams,
  LedgerPhase,
  LegMovement,
  MovementSpec,
  ReserveResult,
  ResolvedBooks,
  SettleDepositParams,
  TransitionParams,
  UpdateJournalTransactionResult,
} from '../interfaces';
import { Book } from '../models';
import { BookRepository } from '../repositories/Book';
import { BookPostingRepository } from '../repositories/BookPosting';
import { JournalTransactionRepository } from '../repositories/JournalTransaction';

/**
 * Nơi DUY NHẤT trong service được phép đụng tới JournalTransaction, BookPosting, Book và
 * CẢ HAI bảng history. Cả SystemTransactionHandler VÀ BlockchainEventHandler PHẢI gọi qua đây.
 * Đúng "Accounting Backbone" trong README:
 *
 *   JournalTransaction ──► JournalTransactionHistory   (history của STATE)
 *          │
 *          ▼
 *     BookPosting ──► Book ──► BookHistory              (history của SỐ DƯ)
 *
 * Mỗi "movement" là 1 bút toán ĐÚP (double-entry): 2 dòng BookPosting đối nhau
 * (1 âm/1 dương, CÙNG |amount|) trên 2 Book khác nhau. Nếu có fee, fee LUÔN là
 * 1 movement ĐỘC LẬP với amount chính (asset có thể khác nhau).
 *
 * Ai ghi history nào:
 *   - openJournal()     -> journal_transaction_history (CREATED)
 *   - transition()      -> journal_transaction_history (STATE_ADVANCED / REJECTED_INVALID_TRANSITION)
 *   - getOrCreateBook   -> book_history (CREATED, amount = 0)        [BookRepository]
 *   - createBookPosting -> book_history (POSTING_APPLIED)            [BookPostingRepository]
 *
 * Idempotency: gọi lại / duplicate event là no-op, KHÔNG nhân đôi posting hay history.
 * Các hàm thuần dùng chung (getAccountingLegs, custodyBookParams, ...) nằm ở `helpers/`.
 */
@singleton()
@autoInjectable()
export class LedgerPipeline {
  private readonly bookRepository: BookRepository;
  private readonly bookPostingRepository: BookPostingRepository;
  private readonly journalTransactionRepository: JournalTransactionRepository;

  constructor(
    bookRepository?: BookRepository,
    bookPostingRepository?: BookPostingRepository,
    journalTransactionRepository?: JournalTransactionRepository,
  ) {
    this.bookRepository = bookRepository!;
    this.bookPostingRepository = bookPostingRepository!;
    this.journalTransactionRepository = journalTransactionRepository!;
  }

  // --------------------------------------------------------------------
  // Journal (state) side — journal_transaction_history
  // --------------------------------------------------------------------

  /** Get-or-create JournalTransaction (idempotent) + history CREATED nếu vừa tạo mới. */
  async openJournal(params: GetOrCreateJournalTransactionParams, tx: SequelizeTransaction): Promise<GetOrCreateJournalTransactionResult> {
    return this.journalTransactionRepository.getOrCreateJournalTransaction(params, tx);
  }

  /**
   * Chuyển state journal (khoá row FOR UPDATE, ghi history), rồi áp hiệu ứng kế toán
   * theo outcome:
   *   - APPLIED       -> chạy `onApplied` (SETTLE / RELEASE) nếu có.
   *   - REPLAYED_NOOP -> KHÔNG làm gì (đã post ở lần trước) — chống post trùng.
   *   - REJECTED_INVALID_TRANSITION -> KHÔNG làm gì. Journal đã bị CANCELLED nhưng tiền reserve
   *     được giữ nguyên ở bucket AUTHORIZING: tự hoàn ở đây sẽ SAI nếu giao dịch thật ra đã
   *     confirm on-chain (double-spend). Việc xử lý các journal này cần quyết định nghiệp vụ.
   *
   * Post accounting SAU khi state được chốt, để 1 transition bị FSM từ chối không bao giờ
   * dẫn tới post nửa chừng.
   */
  async transition(params: TransitionParams, tx: SequelizeTransaction): Promise<UpdateJournalTransactionResult> {
    const { legs, onApplied, ...update } = params;

    const result = await this.journalTransactionRepository.updateJournalTransaction(update, tx);

    if (result.outcome === 'APPLIED' && legs && onApplied) {
      const operation: LedgerOperationParams = {
        journalTransactionId: result.journalTransaction.id,
        uuidToken: result.journalTransaction.uuidToken,
        legs,
        createdBy: update.updatedBy,
      };

      if (onApplied === 'SETTLE') {
        await this.settle(operation, tx);
      } else {
        await this.release(operation, tx);
      }
    }

    return result;
  }

  // --------------------------------------------------------------------
  // Book side — book_posting -> book -> book_history
  // --------------------------------------------------------------------

  /**
   * Resolve (get-or-create, CHƯA khoá) toàn bộ Book cần dùng cho 1 nhóm movement, rồi khoá
   * TẤT CẢ trong CÙNG 1 lượt theo thứ tự id tăng dần — bắt buộc để tránh deadlock.
   *
   * QUAN TRỌNG: bản ghi từ get-or-create có thể đã CŨ nếu transaction khác chen vào trước lúc
   * khoá, nên hàm này trả về bản ghi lấy từ `lockBooksInOrder()` (SELECT ... FOR UPDATE).
   * Mọi chỗ đọc `book.amount` để kiểm tra số dư PHẢI dùng bản ghi đã khoá này.
   */
  private async resolveAndLockAll(specs: MovementSpec[], tx: SequelizeTransaction): Promise<Map<string, ResolvedBooks>> {
    const idsBySpecKey = new Map<string, { fromId: number; toId: number }>();
    const allIds: number[] = [];

    for (const spec of specs) {
      const { book: fromBook } = await this.bookRepository.getOrCreateBook(spec.fromLeg, tx);
      const { book: toBook } = await this.bookRepository.getOrCreateBook(spec.toLeg, tx);

      idsBySpecKey.set(spec.key, { fromId: fromBook.id, toId: toBook.id });
      allIds.push(fromBook.id, toBook.id);
    }

    const lockedBooks = await this.bookRepository.lockBooksInOrder(allIds, tx);
    const resolved = new Map<string, ResolvedBooks>();

    for (const [key, { fromId, toId }] of idsBySpecKey) {
      resolved.set(key, { fromBook: lockedBooks.get(fromId)!, toBook: lockedBooks.get(toId)! });
    }

    return resolved;
  }

  /**
   * Áp 1 bút toán ĐÚP: 2 BookPosting đối nhau (âm ở `fromBook`, dương ở `toBook`, CÙNG |amount|).
   * Mỗi createBookPosting() tự kéo theo update Book.amount + book_history (POSTING_APPLIED).
   * Book truyền vào PHẢI là bản ghi đã khoá; createBookPosting() re-lock lại đúng row đó
   * (an toàn, chỉ tái khẳng định khoá đang giữ trong cùng transaction).
   */
  private async applyMovement(params: ApplyMovementParams, tx: SequelizeTransaction): Promise<void> {
    const { fromBook, toBook, quantity, purposeId, journalTransactionId, createdBy } = params;
    const businessPostDateTime = new Date();
    const tokens = postingTokens(params.movementKey);

    const post = (book: Book, amount: string, idempotencyToken: string) =>
      this.bookPostingRepository.createBookPosting(
        {
          bookId: book.id,
          journalTransactionId,
          amount,
          assetTypeId: book.assetTypeId,
          bookPostingPurposeId: purposeId,
          businessPostDateTime,
          idempotencyToken,
          createdBy,
        },
        tx,
      );

    await post(fromBook, negateQuantity(quantity), tokens.debit);
    await post(toBook, quantity, tokens.credit);
  }

  /** Resolve + khoá + áp TẤT CẢ movement của 1 giai đoạn (RSV/RVT/SET) trong cùng 1 lượt. */
  private async applyAll(
    specs: MovementSpec[],
    resolved: Map<string, ResolvedBooks>,
    operation: Pick<LedgerOperationParams, 'journalTransactionId' | 'uuidToken' | 'createdBy'>,
    phase: LedgerPhase,
    tx: SequelizeTransaction,
  ): Promise<void> {
    for (const spec of specs) {
      const { fromBook, toBook } = resolved.get(spec.key)!;

      await this.applyMovement(
        {
          fromBook,
          toBook,
          quantity: spec.item.quantity,
          purposeId: spec.purposeId,
          journalTransactionId: operation.journalTransactionId,
          movementKey: movementKey(operation.uuidToken, spec.key, phase),
          createdBy: operation.createdBy,
        },
        tx,
      );
    }
  }

  /**
   * AUTHORIZING: CUSTODY@CONFIRMED -> CUSTODY@AUTHORIZING cho từng debitItem VÀ fee.
   *
   * Khoá + kiểm tra đủ số dư cho TẤT CẢ các vế TRƯỚC, rồi mới post — tránh post nửa chừng.
   * Nếu amount và fee cùng asset (cùng 1 Book), số required được CỘNG DỒN theo từng book trước
   * khi so sánh: kiểm tra riêng từng vế sẽ SAI khi 2 vế cộng lại vượt số dư.
   */
  async reserve(params: LedgerOperationParams, tx: SequelizeTransaction): Promise<ReserveResult> {
    const specs = this.buildSpecs(
      collectDebitAndFeeMovements(params.legs),
      TRANSACTION_STATE.CONFIRMED.id,
      TRANSACTION_STATE.AUTHORIZING.id,
      params.createdBy,
    );
    const resolved = await this.resolveAndLockAll(specs, tx);

    const requiredByBookId = new Map<number, bigint>();
    const bookById = new Map<number, Book>();

    for (const spec of specs) {
      const { fromBook } = resolved.get(spec.key)!;

      bookById.set(fromBook.id, fromBook);
      requiredByBookId.set(fromBook.id, (requiredByBookId.get(fromBook.id) ?? 0n) + BigInt(spec.item.quantity));
    }

    const shortfalls: string[] = [];

    for (const [bookId, required] of requiredByBookId) {
      const book = bookById.get(bookId)!;
      const available = BigInt(book.amount);

      if (available < required) {
        shortfalls.push(`bookId=${bookId} assetId=${book.assetId} required=${required} available=${available}`);
      }
    }

    if (shortfalls.length > 0) {
      // KHÔNG post gì cả — toàn bộ request bị từ chối atomically.
      return { ok: false, shortfalls };
    }

    await this.applyAll(specs, resolved, params, 'RSV', tx);

    return { ok: true };
  }

  /** REJECTED hoặc FAILED: hoàn phần đã reserve từ bucket AUTHORIZING về lại bucket CONFIRMED (available). */
  async release(params: LedgerOperationParams, tx: SequelizeTransaction): Promise<void> {
    const specs = this.buildSpecs(
      collectDebitAndFeeMovements(params.legs),
      TRANSACTION_STATE.AUTHORIZING.id,
      TRANSACTION_STATE.CONFIRMED.id,
      params.createdBy,
    );

    await this.applyAll(specs, await this.resolveAndLockAll(specs, tx), params, 'RVT', tx);
  }

  /** CONFIRMED: chốt phần đã reserve sang external (settle), đồng thời ghi nhận các vế credit (UNSTAKE) trả về custody. */
  async settle(params: LedgerOperationParams, tx: SequelizeTransaction): Promise<void> {
    const debitAndFeeSpecs: MovementSpec[] = collectDebitAndFeeMovements(params.legs).map((movement) => ({
      ...movement,
      fromLeg: custodyBookParams(movement.item, TRANSACTION_STATE.AUTHORIZING.id, params.createdBy),
      toLeg: externalBookParams(movement.item, params.createdBy),
    }));

    const creditSpecs: MovementSpec[] = params.legs.creditItems.map((item, index) => ({
      key: `C${index}`,
      item,
      purposeId: BOOK_POSTING_PURPOSE.AMOUNT,
      fromLeg: externalBookParams(item, params.createdBy),
      toLeg: custodyBookParams(item, TRANSACTION_STATE.CONFIRMED.id, params.createdBy),
    }));

    const allSpecs = [...debitAndFeeSpecs, ...creditSpecs];

    await this.applyAll(allSpecs, await this.resolveAndLockAll(allSpecs, tx), params, 'SET', tx);
  }

  /**
   * DEPOSIT: BLOCKCHIAN_EXTERNAL_ACCOUNT -> CUSTODY. Book custody đích đã biết trước (tìm qua
   * BookRepository.findByDepositAddress ở caller), nên chỉ cần resolve/khoá thêm book external.
   */
  async settleDeposit(params: SettleDepositParams, tx: SequelizeTransaction): Promise<void> {
    const { matchedCustodyBook } = params;

    const { book: externalBookUnlocked } = await this.bookRepository.getOrCreateBook(
      externalBookParams(
        {
          assetId: matchedCustodyBook.assetId,
          assetTicker: matchedCustodyBook.assetTicker,
          quantity: params.quantity,
          clientId: matchedCustodyBook.clientId,
          accountId: matchedCustodyBook.accountId,
          assetTypeId: matchedCustodyBook.assetTypeId,
          walletTypeId: matchedCustodyBook.walletTypeId,
        },
        params.createdBy,
      ),
      tx,
    );

    const lockedBooks = await this.bookRepository.lockBooksInOrder([matchedCustodyBook.id, externalBookUnlocked.id], tx);

    await this.applyMovement(
      {
        fromBook: lockedBooks.get(externalBookUnlocked.id)!,
        toBook: lockedBooks.get(matchedCustodyBook.id)!,
        quantity: params.quantity,
        purposeId: BOOK_POSTING_PURPOSE.AMOUNT,
        journalTransactionId: params.journalTransactionId,
        movementKey: depositMovementKey(params.uuidToken),
        createdBy: params.createdBy,
      },
      tx,
    );
  }

  /** Dựng spec cho các movement chuyển giữa 2 bucket CUSTODY của cùng 1 item. */
  private buildSpecs(movements: LegMovement[], fromStateId: number, toStateId: number, createdBy?: number): MovementSpec[] {
    return movements.map((movement) => ({
      ...movement,
      fromLeg: custodyBookParams(movement.item, fromStateId, createdBy),
      toLeg: custodyBookParams(movement.item, toStateId, createdBy),
    }));
  }
}
