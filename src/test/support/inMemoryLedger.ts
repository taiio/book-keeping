import 'reflect-metadata';

import { mock } from 'node:test';
import type { Transaction as SequelizeTransaction } from 'sequelize';

import type { UnitOfWork } from '../../common/UnitOfWork';
import { sequelize } from '../../config/database';
import { BOOK_PURPOSE, TRANSACTION_STATE } from '../../constants';
import { custodyBookParams } from '../../helpers';
import { BlockchainEventHandler } from '../../handler/BlockchainEventHandler';
import { LedgerPipeline } from '../../handler/LedgerPipeline';
import { SystemTransactionHandler } from '../../handler/SystemTransactionHandler';
import { Book, BookHistory, BookPosting, JournalTransaction, JournalTransactionHistory } from '../../models';
import {
  BookHistoryRepository,
  BookPostingRepository,
  BookRepository,
  JournalTransactionHistoryRepository,
  JournalTransactionRepository,
} from '../../repositories';

// ============================================================================
// Test harness: chạy handler + LedgerPipeline + repository THẬT trên dữ liệu in-memory.
//
// Chỉ các static method truy vấn của Sequelize model (findOne / findByPk / findOrCreate / create)
// bị thay bằng bảng in-memory, nên toàn bộ logic thật — FSM của journal, idempotency, khoá book,
// double-entry, ghi history — vẫn được chạy, không cần Postgres.
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;

/** Danh tính dùng chung cho mọi test: 1 client, 1 account, 1 asset (BTC). */
export const TEST_ACCOUNT = {
  clientId: 1,
  accountId: 10,
  assetId: 1,
  assetTypeId: 1,
  walletTypeId: 1,
  assetTicker: 'BTC',
} as const;

/** Tiêu chí tìm Book theo (purpose, state, ticker) — dùng với `TestLedger.amountOf()`. Tên bucket theo design doc. */
const custody = (transactionStateId: number, assetTicker: string) => ({
  bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
  transactionStateId,
  assetTicker,
});

export const BOOK = {
  custodyAvailable: (assetTicker: string) => custody(TRANSACTION_STATE.CONFIRMED.id, assetTicker),
  custodyReserved: (assetTicker: string) => custody(TRANSACTION_STATE.AUTHORIZING.id, assetTicker),
  custodyAuthorized: (assetTicker: string) => custody(TRANSACTION_STATE.AUTHORIZED.id, assetTicker),
  custodySent: (assetTicker: string) => custody(TRANSACTION_STATE.SENT.id, assetTicker),
  custodyConfirming: (assetTicker: string) => custody(TRANSACTION_STATE.CONFIRMING.id, assetTicker),
  feeConfirming: (assetTicker: string) => ({
    bookPurposeId: BOOK_PURPOSE.FEE_CONFIRMING_ACCOUNT.id,
    transactionStateId: TRANSACTION_STATE.CONFIRMING.id,
    assetTicker,
  }),
  feeRevenue: (assetTicker: string) => ({
    bookPurposeId: BOOK_PURPOSE.FEE_REVENUE_ACCOUNT.id,
    transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
    assetTicker,
  }),
  external: (assetTicker: string) => ({
    bookPurposeId: BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.id,
    transactionStateId: TRANSACTION_STATE.NOT_APPLICABLE.id,
    assetTicker,
  }),
};

class InMemoryTable {
  readonly rows: Row[] = [];
  private nextId = 1;

  insert(values: Row): Row {
    const row: Row = { id: this.nextId++, createdDate: new Date(), updatedDate: null, ...values };

    // Model instance thật có `save()`; ở đây row là object sống trong bảng nên save không cần làm gì.
    Object.defineProperty(row, 'save', { value: async () => row, enumerable: false });
    this.rows.push(row);

    return row;
  }

  find(where: Row = {}): Row | null {
    return this.rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null;
  }

  findByPk(id: number): Row | null {
    return this.rows.find((row) => row.id === id) ?? null;
  }
}

function patchModel(model: unknown, table: InMemoryTable): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const patch = (name: string, impl: (...args: any[]) => unknown) => mock.method(model as any, name as any, impl as any);

  patch('findOne', async ({ where }: { where?: Row } = {}) => table.find(where));
  patch('findByPk', async (id: number) => table.findByPk(id));
  patch('create', async (values: Row) => table.insert(values));
  patch('findOrCreate', async ({ where, defaults }: { where: Row; defaults?: Row }) => {
    const existing = table.find(where);

    return existing ? [existing, false] : [table.insert({ ...where, ...defaults }), true];
  });
}

export interface RecipientBooksParams {
  /** Địa chỉ nhận deposit của recipient. */
  address: string;
  assetTicker?: string;
}

export interface SeedCustodyBookParams {
  assetTicker?: string;
  amount: string;
  /** Địa chỉ nhận deposit của book (chỉ cần cho test deposit). */
  address?: string;
}

export function createTestLedger() {
  const tables = {
    books: new InMemoryTable(),
    bookPostings: new InMemoryTable(),
    bookHistories: new InMemoryTable(),
    journals: new InMemoryTable(),
    journalHistories: new InMemoryTable(),
  };

  patchModel(Book, tables.books);
  patchModel(BookPosting, tables.bookPostings);
  patchModel(BookHistory, tables.bookHistories);
  patchModel(JournalTransaction, tables.journals);
  patchModel(JournalTransactionHistory, tables.journalHistories);

  // UnitOfWork thật mở 1 DB transaction; ở đây chỉ cần chạy `work` với 1 transaction giả (repository chỉ đọc `tx.LOCK.UPDATE`).
  const fakeTransaction = { LOCK: { UPDATE: 'UPDATE' } } as unknown as SequelizeTransaction;
  const unitOfWork: UnitOfWork = {
    async execute<T>(work: (tx: SequelizeTransaction) => Promise<T>): Promise<T> {
      return work(fakeTransaction);
    },
  };

  const journalTransactionRepository = new JournalTransactionRepository(new JournalTransactionHistoryRepository());
  const bookRepository = new BookRepository(new BookHistoryRepository());
  const bookPostingRepository = new BookPostingRepository(bookRepository);
  const ledgerPipeline = new LedgerPipeline(bookRepository, bookPostingRepository, journalTransactionRepository);

  return {
    tables,
    systemTransactionHandler: new SystemTransactionHandler(unitOfWork, ledgerPipeline),
    blockchainEventHandler: new BlockchainEventHandler(unitOfWork, journalTransactionRepository, bookRepository, ledgerPipeline),

    /** Tạo sẵn book custody ở bucket CONFIRMED (số dư khả dụng) — điểm bắt đầu của mọi test. */
    seedCustodyBook({ assetTicker = TEST_ACCOUNT.assetTicker, amount, address }: SeedCustodyBookParams): Row {
      return tables.books.insert({
        name: `${assetTicker} custody`,
        ...TEST_ACCOUNT,
        ...BOOK.custodyAvailable(assetTicker),
        amount,
        lastSequenceNo: 0,
        address: address ?? null,
      });
    },

    /**
     * Tạo sẵn các book của recipient TRƯỚC khi deposit, đúng thứ tự thật của hệ thống: book được mở qua
     * BookRepository.getOrCreateBook (nên có book_history CREATED, amount = 0), không insert thẳng vào bảng.
     *   - Available (custody @ CONFIRMED) gắn với địa chỉ nhận — book mà BlockchainEventHandler tìm theo address.
     *   - Confirming (custody @ CONFIRMING) — bucket deposit đi qua trước khi vào Available.
     * Book External là book hệ thống dùng chung (không thuộc recipient) nên do pipeline tự get-or-create.
     */
    async createRecipientBooks({ address, assetTicker = TEST_ACCOUNT.assetTicker }: RecipientBooksParams) {
      const item = { ...TEST_ACCOUNT, assetTicker, quantity: '0' };

      const { book: available } = await bookRepository.getOrCreateBook(
        { ...custodyBookParams(item, TRANSACTION_STATE.CONFIRMED.id), address },
        fakeTransaction,
      );
      const { book: confirming } = await bookRepository.getOrCreateBook(custodyBookParams(item, TRANSACTION_STATE.CONFIRMING.id), fakeTransaction);

      return { available, confirming };
    },

    /** Số dư của book khớp `match`, hoặc undefined nếu book chưa tồn tại. */
    amountOf(match: Row): string | undefined {
      return tables.books.find(match)?.amount;
    },

    /** Tổng số dư của MỌI book — bất biến của double-entry: không đổi sau bất kỳ movement nào. */
    totalBalance(): bigint {
      return tables.books.rows.reduce((sum, book) => sum + BigInt(book.amount), 0n);
    },

    /** Tổng các posting — luôn bằng 0 vì mỗi movement là 1 cặp âm/dương đối nhau. */
    totalPosted(): bigint {
      return tables.bookPostings.rows.reduce((sum, posting) => sum + BigInt(posting.amount), 0n);
    },

    restore(): void {
      mock.restoreAll();
    },
  };
}

export type TestLedger = ReturnType<typeof createTestLedger>;

/** `config/database` tạo sẵn 1 Sequelize instance khi được import; đóng lại để tiến trình test kết thúc sạch. */
export async function closeTestDatabase(): Promise<void> {
  await sequelize.close();
}
