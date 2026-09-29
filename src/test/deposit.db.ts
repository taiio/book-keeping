import crypto from 'crypto';
import { BLOCKCHAIN_TRANSACTION_STATUS, BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';

import type { BlockchainMessagePayload } from '../interfaces';

import { sequelize } from '../config/database';
import { UnitOfWork } from '../common/UnitOfWork';
import { BlockchainEventHandler } from '../handler/BlockchainEventHandler';
import { custodyBookParams } from '../helpers';
import { Book } from '../models';
import { BookRepository } from '../repositories/Book';

/**
 * Chạy DEPOSIT trên DB thật (script thủ công, không phải unit test):
 *   npm run sync-db          # tạo bảng + seed book_purpose / transaction_state
 *   ts-node src/test/deposit.db.ts
 *
 * Đúng logic thật: book của recipient được tạo TRƯỚC khi deposit xảy ra.
 *   External là book hệ thống dùng chung nên do LedgerPipeline tự get-or-create.
 */

// Mỗi lần chạy dùng hash riêng — deposit idempotent theo (hash, address, ticker) nên chạy lại cùng hash sẽ chỉ là replay.
const RUN_ID = Date.now();
const CONFIRMED_HASH = crypto.randomBytes(32).toString('hex'); // deposit đầu tiên, hash cố định để test CONFIRMED
const FAILED_HASH = crypto.randomBytes(32).toString('hex'); // deposit khác, hash khác, để test FAILED
const idempotencyToken = crypto.randomUUID(); // token bất biến cho cả vòng đời deposit này

const DEPOSIT_ADDRESS = 'addr-deposit-db-1';
const ASSET_TICKER = 'BTC';
const QUANTITY = '1000';

// Danh tính account nhận deposit (khớp với dữ liệu seed của bạn nếu có ràng buộc FK).
const RECIPIENT_ACCOUNT = {
  clientId: 1,
  accountId: 10,
  assetId: 1,
  assetTypeId: 1,
  walletTypeId: 1,
} as const;

function createDepositEvent(transactionHash: string, status: BlockchainMessagePayload['status']): BlockchainMessagePayload {
  return {
    transactionHash,
    status,
    idempotencyToken,
    senders: [
      {
        address: 'addr-external-sender',
        assetTicker: ASSET_TICKER,
        quantity: QUANTITY,
      },
    ],

    recipients: [
      {
        address: DEPOSIT_ADDRESS,
        assetTicker: ASSET_TICKER,
        quantity: QUANTITY,
        type: 'AMOUNT',
      },
    ],
  };
}

/**
 * Tạo book của recipient trước khi deposit, qua BookRepository.getOrCreateBook thật
 * (nên có book_history CREATED). Get-or-create nên chạy lại script không tạo trùng.
 *   - Available: custody @ CONFIRMED, gắn với địa chỉ nhận (handler tìm book theo address).
 *   - Confirming: custody @ CONFIRMING, bucket deposit đi qua trước khi vào Available.
 */
async function createRecipientBooks(): Promise<void> {
  const unitOfWork = new UnitOfWork();
  const bookRepository = new BookRepository();
  const item = { ...RECIPIENT_ACCOUNT, assetTicker: ASSET_TICKER, quantity: '0' };

  await unitOfWork.execute(async (tx) => {
    const { book: available, created: availableCreated } = await bookRepository.getOrCreateBook(
      { ...custodyBookParams(item, TRANSACTION_STATE.CONFIRMED.id), address: DEPOSIT_ADDRESS },
      tx,
    );
    const { book: confirming, created: confirmingCreated } = await bookRepository.getOrCreateBook(
      custodyBookParams(item, TRANSACTION_STATE.CONFIRMING.id),
      tx,
    );

    console.log(`Available book  #${available.id} (${availableCreated ? 'created' : 'already exists'})`);
    console.log(`Confirming book #${confirming.id} (${confirmingCreated ? 'created' : 'already exists'})`);
  });
}

/** In số dư của mọi book BTC để thấy tiền đang nằm ở đâu sau mỗi bước. */
async function printBalances(label: string): Promise<void> {
  const books = await Book.findAll({ where: { assetTicker: ASSET_TICKER }, order: [['id', 'ASC']] });

  const purposeName = (purposeId: number) => Object.values(BOOK_PURPOSE).find((purpose) => purpose.id === purposeId)?.code ?? String(purposeId);
  const stateName = (stateId: number | null) => Object.values(TRANSACTION_STATE).find((state) => state.id === stateId)?.code ?? 'N/A';

  console.log(`\n--- Balances after ${label} ---`);
  console.table(
    books.map((book) => ({
      id: book.id,
      purpose: purposeName(book.bookPurposeId),
      state: stateName(book.transactionStateId),
      address: book.address,
      amount: book.amount,
    })),
  );

  const total = books.reduce((sum, book) => sum + BigInt(book.amount), 0n);

  console.log(`Sum of all books: ${total} (double-entry: phải là 0 khi DB chỉ có deposit của script này)`);
}

async function main() {
  try {
    await sequelize.authenticate();

    console.log('Database connected.');

    // --------------------------------------------------
    // 0. TẠO BOOK CHO RECIPIENT TRƯỚC KHI DEPOSIT
    // --------------------------------------------------

    console.log('\n========== CREATE RECIPIENT BOOKS ==========\n');

    await createRecipientBooks();

    // Khởi tạo class thật của application.
    const blockchainEventHandler = new BlockchainEventHandler();

    // --------------------------------------------------
    // 1. CONFIRMING            External -> Confirming
    // --------------------------------------------------

    console.log('\n========== CONFIRMING ==========\n');

    const confirming = await blockchainEventHandler.handle(createDepositEvent(CONFIRMED_HASH, BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    console.dir(confirming, { depth: null });
    await printBalances('CONFIRMING');

    // --------------------------------------------------
    // 2. CONFIRMED             Confirming -> Available
    // --------------------------------------------------

    console.log('\n========== CONFIRMED ==========\n');

    const confirmed = await blockchainEventHandler.handle(createDepositEvent(CONFIRMED_HASH, BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    console.dir(confirmed, { depth: null });
    await printBalances('CONFIRMED');

    // --------------------------------------------------
    // 3. DUPLICATE CONFIRMED   không post lại
    // --------------------------------------------------

    // console.log('\n========== DUPLICATE CONFIRMED ==========\n');

    // const duplicate = await blockchainEventHandler.handle(createDepositEvent(CONFIRMED_HASH, BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    // console.dir(duplicate, { depth: null });
    // await printBalances('DUPLICATE CONFIRMED (số dư không đổi)');

    // // --------------------------------------------------
    // // 4. FAILED                Confirming -> External (deposit khác, hash khác)
    // // --------------------------------------------------

    // console.log('\n========== CONFIRMING (deposit #2) ==========\n');

    // await blockchainEventHandler.handle(createDepositEvent(FAILED_HASH, BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    // console.log('\n========== FAILED (deposit #2) ==========\n');

    // const failed = await blockchainEventHandler.handle(createDepositEvent(FAILED_HASH, BLOCKCHAIN_TRANSACTION_STATUS.FAILED));

    // console.dir(failed, { depth: null });
    // await printBalances('FAILED (deposit #2 được hoàn lại, Available chỉ còn deposit #1)');
  } catch (error) {
    console.error('\nERROR:\n');

    console.error(error);

    if (error instanceof Error) {
      console.error(error.stack);
    }
  } finally {
    await sequelize.close();
  }
}

main();
