import { Transaction as SequelizeTransaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { BOOK_POSTING_PURPOSE, TRANSACTION_STATE, TRANSACTION_STATE_CODE_BY_ID } from '../constants';
import {
  collectDebitAndFeeMovements,
  custodyBookParams,
  depositMovementKey,
  externalBookParams,
  feeConfirmingBookParams,
  feeRevenueBookParams,
  movementKey,
  negateQuantity,
  postingTokens,
} from '../helpers';
import {
  ApplyMovementParams,
  BucketMoveParams,
  DepositMovementParams,
  DepositPhase,
  GetOrCreateJournalTransactionParams,
  GetOrCreateJournalTransactionResult,
  LedgerOperationParams,
  LedgerPhase,
  LegItem,
  LegMovement,
  MovementSpec,
  ReserveResult,
  ResolvedBooks,
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
 * Mỗi bước của vòng đời có ĐÚNG 1 bút toán đúp (design doc):
 *
 *   WITHDRAW   AUTHORIZING  kiểm tra amount + fee (thiếu -> REJECTED, không post); đủ -> Available -> Reserved
 *              AUTHORIZED   Reserved   -> Authorized
 *              SENT         Authorized -> Sent
 *              CONFIRMING   Sent       -> Confirming
 *              CONFIRMED    Confirming -> External (amount);  Confirming -> Fee Confirming -> Fee Revenue (fee)
 *              FAILED       bucket hiện tại (Authorized/Sent/Confirming) -> Available
 *
 *   DEPOSIT    CONFIRMING   External   -> Confirming
 *              CONFIRMED    Confirming -> Available
 *              FAILED       Confirming -> External
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
   * Chuyển state journal (khoá row FOR UPDATE, ghi history), rồi áp bút toán của bước đó
   * theo outcome:
   *   - APPLIED       -> chạy `onApplied` (ADVANCE / SETTLE / RELEASE) nếu có.
   *   - REPLAYED_NOOP -> KHÔNG làm gì (đã post ở lần trước) — chống post trùng.
   *   - REJECTED_INVALID_TRANSITION -> KHÔNG làm gì. Journal đã bị CANCELLED nhưng tiền được giữ
   *     nguyên ở bucket hiện tại: tự hoàn ở đây sẽ SAI nếu giao dịch thật ra đã confirm on-chain
   *     (double-spend). Việc xử lý các journal này cần quyết định nghiệp vụ.
   *
   * Post accounting SAU khi state được chốt, để 1 transition bị FSM từ chối không bao giờ
   * dẫn tới post nửa chừng. Bucket nguồn luôn là state TRƯỚC khi chuyển (previousTransactionStateId).
   */
  async transition(params: TransitionParams, tx: SequelizeTransaction): Promise<UpdateJournalTransactionResult> {
    const { legs, onApplied, ...update } = params;

    const result = await this.journalTransactionRepository.updateJournalTransaction(update, tx);

    if (result.outcome === 'APPLIED' && legs && onApplied && result.previousTransactionStateId != null) {
      const operation: BucketMoveParams = {
        journalTransactionId: result.journalTransaction.id,
        uuidToken: result.journalTransaction.uuidToken,
        legs,
        createdBy: update.updatedBy,
        fromStateId: result.previousTransactionStateId,
        toStateId: result.journalTransaction.transactionStateId ?? undefined,
      };

      if (onApplied === 'ADVANCE') {
        await this.advance(operation, tx);
      } else if (onApplied === 'SETTLE') {
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

  /** Resolve + khoá + áp TẤT CẢ movement của 1 giai đoạn trong cùng 1 lượt (khoá theo thứ tự id, chống deadlock). */
  private async applyAll(
    specs: MovementSpec[],
    operation: Pick<LedgerOperationParams, 'journalTransactionId' | 'uuidToken' | 'createdBy'>,
    phase: LedgerPhase,
    tx: SequelizeTransaction,
    preResolved?: Map<string, ResolvedBooks>,
  ): Promise<void> {
    const resolved = preResolved ?? (await this.resolveAndLockAll(specs, tx));

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

  // --------------------------------------------------------------------
  // WITHDRAW / STAKE / UNSTAKE / RESTAKE
  // --------------------------------------------------------------------

  /**
   * AUTHORIZING: kiểm tra Available đủ cho amount + fee, đủ thì post Available -> Reserved.
   * Thiếu -> KHÔNG post gì (design: INSUFFICIENT -> REJECTED, NO POST), toàn bộ request bị từ chối atomically.
   *
   * Khoá TẤT CẢ book liên quan trong 1 lượt rồi mới so sánh, và post trên chính các book đã khoá đó (không có
   * khe hở giữa kiểm tra và post). Nếu amount và fee cùng asset (cùng 1 Book), số required được CỘNG DỒN theo
   * từng book trước khi so sánh: kiểm tra riêng từng vế sẽ SAI khi 2 vế cộng lại vượt số dư.
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
      return { ok: false, shortfalls };
    }

    await this.applyAll(specs, params, `ADV:${TRANSACTION_STATE.AUTHORIZING.code}`, tx, resolved);

    return { ok: true };
  }

  /**
   * AUTHORIZED / SENT / CONFIRMING: chuyển debit + fee từ bucket của state trước sang bucket của state mới
   * (Reserved -> Authorized -> Sent -> Confirming). Phase của khoá idempotency gắn với state ĐÍCH.
   * (Bước AUTHORIZING Available -> Reserved do `reserve()` làm vì phải kiểm tra số dư cùng lúc.)
   */
  async advance(params: BucketMoveParams, tx: SequelizeTransaction): Promise<void> {
    if (params.toStateId == null) {
      throw new Error('advance() requires toStateId.');
    }

    const specs = this.buildSpecs(collectDebitAndFeeMovements(params.legs), params.fromStateId, params.toStateId, params.createdBy);
    const phase: LedgerPhase = `ADV:${TRANSACTION_STATE_CODE_BY_ID[params.toStateId]}`;

    await this.applyAll(specs, params, phase, tx);
  }

  /**
   * REJECTED hoặc FAILED: hoàn phần đang giữ từ bucket hiện tại (Authorized / Sent / Confirming) về Available.
   * Journal bị REJECTED ngay ở AUTHORIZING vì thiếu số dư thì chưa có bút toán nào để hoàn — caller không truyền `legs`.
   */
  async release(params: BucketMoveParams, tx: SequelizeTransaction): Promise<void> {
    const specs = this.buildSpecs(collectDebitAndFeeMovements(params.legs), params.fromStateId, TRANSACTION_STATE.CONFIRMED.id, params.createdBy);

    await this.applyAll(specs, params, 'RVT', tx);
  }

  /**
   * CONFIRMED (từ bucket Confirming):
   *   - amount: Confirming -> External
   *   - fee   : Confirming -> Fee Confirming -> Fee Revenue (2 bút toán liên tiếp để giữ đủ vết audit)
   *   - credit (UNSTAKE): External -> Available
   */
  async settle(params: BucketMoveParams, tx: SequelizeTransaction): Promise<void> {
    const fromStateId = params.fromStateId;
    const specs: MovementSpec[] = [];

    for (const movement of collectDebitAndFeeMovements(params.legs)) {
      if (movement.purposeId === BOOK_POSTING_PURPOSE.FEE) {
        specs.push(
          {
            ...movement,
            fromLeg: custodyBookParams(movement.item, fromStateId, params.createdBy),
            toLeg: feeConfirmingBookParams(movement.item, params.createdBy),
          },
          {
            ...movement,
            key: `${movement.key}:REV`,
            fromLeg: feeConfirmingBookParams(movement.item, params.createdBy),
            toLeg: feeRevenueBookParams(movement.item, params.createdBy),
          },
        );
      } else {
        specs.push({
          ...movement,
          fromLeg: custodyBookParams(movement.item, fromStateId, params.createdBy),
          toLeg: externalBookParams(movement.item, params.createdBy),
        });
      }
    }

    params.legs.creditItems.forEach((item, index) => {
      specs.push({
        key: `C${index}`,
        item,
        purposeId: BOOK_POSTING_PURPOSE.AMOUNT,
        fromLeg: externalBookParams(item, params.createdBy),
        toLeg: custodyBookParams(item, TRANSACTION_STATE.CONFIRMED.id, params.createdBy),
      });
    });

    await this.applyAll(specs, params, 'SET', tx);
  }

  // --------------------------------------------------------------------
  // DEPOSIT
  // --------------------------------------------------------------------

  /**
   * DEPOSIT — bút toán của từng bước (Book custody Available đích đã biết trước qua BookRepository.findByDepositAddress):
   *   CONFIRMING: External   -> Confirming
   *   CONFIRMED : Confirming -> Available
   *   FAILED    : Confirming -> External
   * Khoá idempotency theo (journal, phase) nên gọi lại cùng bước là no-op.
   */
  async postDeposit(phase: DepositPhase, params: DepositMovementParams, tx: SequelizeTransaction): Promise<void> {
    const { matchedCustodyBook: available } = params;

    const item: LegItem = {
      assetId: available.assetId,
      assetTicker: available.assetTicker,
      quantity: params.quantity,
      clientId: available.clientId,
      accountId: available.accountId,
      assetTypeId: available.assetTypeId,
      walletTypeId: available.walletTypeId,
    };

    const { book: confirmingUnlocked } = await this.bookRepository.getOrCreateBook(
      custodyBookParams(item, TRANSACTION_STATE.CONFIRMING.id, params.createdBy),
      tx,
    );
    const { book: externalUnlocked } = await this.bookRepository.getOrCreateBook(externalBookParams(item, params.createdBy), tx);

    const locked = await this.bookRepository.lockBooksInOrder([available.id, confirmingUnlocked.id, externalUnlocked.id], tx);
    const confirming = locked.get(confirmingUnlocked.id)!;
    const external = locked.get(externalUnlocked.id)!;

    const [fromBook, toBook] =
      phase === 'CONFIRMING' ? [external, confirming] : phase === 'CONFIRMED' ? [confirming, locked.get(available.id)!] : [confirming, external];

    await this.applyMovement(
      {
        fromBook,
        toBook,
        quantity: params.quantity,
        purposeId: BOOK_POSTING_PURPOSE.AMOUNT,
        journalTransactionId: params.journalTransactionId,
        movementKey: depositMovementKey(params.uuidToken, phase),
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
