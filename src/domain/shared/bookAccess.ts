import { Transaction } from 'sequelize';

import { Book } from '../../models';
import { BookRepository } from '../../repositories';
import { AssetBookDescriptor } from './types';

/**
 * Mô tả 1 "bucket" (Book) cần mở/lấy ra, tách biệt asset (AssetBookDescriptor)
 * khỏi phần nghiệp vụ (purpose + state).
 *
 * Trước khi có helper này, mọi flow (Deposit/Stake/Withdraw) đều tự lặp lại
 * y hệt khối gọi `bookRepository.getOrCreateBook({...9 field...})` — riêng
 * WithdrawFlow.ts lặp lại khối này 6 LẦN. `openBook()` gom logic đó về 1 chỗ
 * duy nhất để mọi flow tái sử dụng thay vì copy-paste.
 */
export interface BookSpec {
  /** BOOK_PURPOSE.<X>.code — dùng làm Book.name khi tạo mới. */
  code: string;
  bookPurposeId: number;
  transactionStateId: number | null;
  asset: AssetBookDescriptor;
  createdBy?: number | null;
}

export async function openBook(bookRepository: BookRepository, spec: BookSpec, transaction: Transaction): Promise<Book> {
  const { book } = await bookRepository.getOrCreateBook(
    {
      name: spec.code,
      bookPurposeId: spec.bookPurposeId,
      transactionStateId: spec.transactionStateId,
      clientId: spec.asset.clientId,
      accountId: spec.asset.accountId,
      assetId: spec.asset.assetId,
      assetTypeId: spec.asset.assetTypeId,
      assetTicker: spec.asset.assetTicker,
      walletTypeId: spec.asset.walletTypeId,
      address: spec.asset.address,
      createdBy: spec.createdBy ?? null,
    },
    transaction,
  );

  return book;
}

/** Mở nhiều book cùng lúc (tuần tự — getOrCreateBook không cần thứ tự lock). */
export async function openBooks(bookRepository: BookRepository, specs: BookSpec[], transaction: Transaction): Promise<Book[]> {
  const books: Book[] = [];
  for (const spec of specs) {
    books.push(await openBook(bookRepository, spec, transaction));
  }
  return books;
}

/** Suy ra lại AssetBookDescriptor từ 1 Book đã tồn tại — dùng khi cần mở 1 book "chị em" (cùng asset, khác purpose/state) mà chỉ có sẵn book gốc, không có request. */
export function assetDescriptorOfBook(book: Book): AssetBookDescriptor {
  return {
    clientId: book.clientId,
    accountId: book.accountId,
    assetId: book.assetId,
    assetTypeId: book.assetTypeId,
    assetTicker: book.assetTicker,
    walletTypeId: book.walletTypeId,
    address: book.address,
  };
}
