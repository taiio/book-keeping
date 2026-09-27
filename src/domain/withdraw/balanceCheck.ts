import { Transaction } from 'sequelize';

import { Book } from '../../models';
import { BookRepository } from '../../repositories';
import { BOOK_PURPOSE, TRANSACTION_STATE } from '../../constants';
import { WithdrawRejectedError } from '../../common/errors';
import { resolveAmountAsset, resolveFeeAsset } from '../shared/types';
import { openBook } from '../shared/bookAccess';
import { WithdrawRequest } from './types';

export interface SufficientBalanceCheckResult {
  clientAmountBook: Book;
  clientFeeBook: Book;
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
export async function assertSufficientBalanceOrThrow(
  bookRepository: BookRepository,
  request: WithdrawRequest,
  transaction: Transaction,
): Promise<SufficientBalanceCheckResult> {
  const amountAsset = resolveAmountAsset(request);
  const feeAsset = resolveFeeAsset(request);
  const sameAsset = feeAsset.assetTypeId === amountAsset.assetTypeId && feeAsset.assetId === amountAsset.assetId;

  const clientAmountBookUnlocked = await openBook(
    bookRepository,
    {
      code: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
      bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
      transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
      asset: amountAsset,
      createdBy: request.createdBy,
    },
    transaction,
  );

  if (sameAsset) {
    const clientAmountBook = await bookRepository.lockBookById(clientAmountBookUnlocked.id, transaction);
    const needed = BigInt(request.amount) + BigInt(request.fee);

    if (BigInt(clientAmountBook.amount) < needed) {
      throw new WithdrawRejectedError([
        `assetType ${amountAsset.assetTypeId}: cần ${needed.toString()} (amount ${request.amount} + fee ${request.fee}), hiện có ${clientAmountBook.amount}`,
      ]);
    }

    return { clientAmountBook, clientFeeBook: clientAmountBook };
  }

  const clientFeeBookUnlocked = await openBook(
    bookRepository,
    {
      code: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
      bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
      transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
      asset: feeAsset,
      createdBy: request.createdBy,
    },
    transaction,
  );

  const locked = await bookRepository.lockBooksInOrder([clientAmountBookUnlocked.id, clientFeeBookUnlocked.id], transaction);
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
