import { Transaction } from 'sequelize';
import { autoInjectable, singleton } from 'tsyringe';

import { Book, BookHistory } from '../models';
import { NotFoundError, InsufficientBalanceError } from '../common/errors';
import type { GetOrCreateBookParams, GetOrCreateBookResult, UpdateBookParams } from './interfaces';
import { BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';

@singleton()
@autoInjectable()
export class BookRepository {
  /**
   * Idempotent theo khoá tự nhiên (client_id, account_id, asset_type_id,
   * wallet_type_id, book_purpose_id, transaction_state_id) — đúng với
   * `idx_unique_book`.
   *
   * Trước đây: `findOne` rồi `create`, cùng 1 race TOCTOU như
   * JournalTransactionRepository — 2 flow (vd deposit đang chạy song song
   * với chính nó do client bấm 2 lần / retry ở tầng gateway) có thể cùng
   * SELECT ra "chưa có book" rồi cùng INSERT, 1 trong 2 sẽ vỡ unique
   * constraint và văng lỗi thay vì im lặng trả về book đã tồn tại.
   *
   * Dùng `findOrCreate` để nhờ Sequelize xử lý bằng SAVEPOINT nội bộ
   * (SELECT -> INSERT -> nếu unique violation thì rollback về savepoint và
   * SELECT lại), toàn bộ vẫn nằm trong transaction của unitOfWork.
   */
  async getOrCreateBook(params: GetOrCreateBookParams, transaction: Transaction): Promise<GetOrCreateBookResult> {
    const [book, created] = await Book.findOrCreate({
      where: {
        clientId: params.clientId,
        accountId: params.accountId,
        assetTypeId: params.assetTypeId,
        walletTypeId: params.walletTypeId,
        bookPurposeId: params.bookPurposeId,
        transactionStateId: params.transactionStateId,
      },
      defaults: {
        name: params.name,
        assetId: params.assetId,
        assetTicker: params.assetTicker,
        address: params.address ?? null,
        amount: '0',
        lastSequenceNo: 0,
        createdBy: params.createdBy ?? null,
      },
      transaction,
    });

    return { book, created };
  }

  async lockBookById(bookId: number, tx: Transaction): Promise<Book> {
    const book = await Book.findByPk(bookId, { transaction: tx, lock: tx.LOCK.UPDATE });

    if (!book) {
      throw new NotFoundError('Book', bookId);
    }

    return book;
  }

  /**
   * Khoá nhiều book cùng lúc, LUÔN theo thứ tự id tăng dần, bất kể thứ tự
   * bookId truyền vào.
   *
   * Lý do: mọi flow (deposit, withdraw, stake, unstake...) trong hệ thống
   * này đều phải lock 2 book (vd CLIENT_ASSET_ACCOUNT và
   * CUSTODY_CONTROL_ACCOUNT) trong CÙNG 1 transaction. Nếu flow A khoá
   * book X trước rồi tới Y, còn flow B (chạy song song, vd unstake đang
   * chạy cùng lúc với 1 stake khác) lại khoá Y trước rồi tới X, đây chính
   * là công thức kinh điển của deadlock: Postgres phải chọn 1 transaction
   * để abort. Ép mọi nơi lock theo thứ tự id tăng dần loại bỏ hoàn toàn
   * khả năng đó — tại mọi thời điểm, "ai khoá được row có id nhỏ hơn
   * trước" luôn nhất quán giữa các transaction.
   */
  async lockBooksInOrder(bookIds: number[], tx: Transaction): Promise<Map<number, Book>> {
    const uniqueSortedIds = Array.from(new Set(bookIds)).sort((a, b) => a - b);
    const result = new Map<number, Book>();

    for (const id of uniqueSortedIds) {
      result.set(id, await this.lockBookById(id, tx));
    }

    return result;
  }

  async updateBook(params: UpdateBookParams, transaction: Transaction): Promise<Book> {
    const { book, amountDelta, sequenceNo, bookPostingId, transactionStateId, historyTransactionTypeId, updatedBy } = params;

    const currentAmount = BigInt(book.amount ?? '0');
    const delta = BigInt(amountDelta);
    const nextAmount = currentAmount + delta;

    if (
      nextAmount < 0n &&
      book.bookPurposeId === BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id &&
      book.transactionStateId === TRANSACTION_STATE.CONFIRMED.id
    ) {
      throw new InsufficientBalanceError(book.id, book.amount, amountDelta);
    }

    book.amount = nextAmount.toString();
    book.lastSequenceNo = sequenceNo || 1;

    if (transactionStateId !== undefined) {
      book.transactionStateId = transactionStateId;
    }

    book.updatedDate = new Date();
    book.updatedBy = updatedBy ?? null;

    await book.save({ transaction });

    await BookHistory.create(
      {
        historyTransactionTypeId,
        bookId: book.id,
        bookPostingId: bookPostingId ?? null,
        amount: book.amount,
        lastSequenceNo: sequenceNo,
        createdBy: updatedBy ?? null,
      },
      { transaction },
    );

    return book;
  }
}
