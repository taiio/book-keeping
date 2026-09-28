import type { BlockchainMessagePayload, Transaction } from '../interfaces';
import type { JournalTransaction } from '../models';

/**
 * Đọc lại payload gốc của system transaction từ `sourceContent` (được lưu lúc AUTHORIZING).
 * Trả về null nếu thiếu hoặc hỏng — caller vẫn xử lý được (dữ liệu cũ / audit bị mất).
 */
export function parseSourceContent(journalTransaction: JournalTransaction): Transaction | null {
  if (!journalTransaction.sourceContent) {
    return null;
  }

  try {
    return JSON.parse(journalTransaction.sourceContent) as Transaction;
  } catch {
    return null;
  }
}

function extractDeclaredAddresses(transaction: Transaction): string[] {
  const senders = Array.isArray(transaction.sender) ? transaction.sender : [transaction.sender];

  return senders.map((item) => item.address).filter((address): address is string => !!address);
}

/**
 * Đối chiếu sender của blockchain event với address mà request gốc đã khai báo.
 * Nếu request gốc không có address cụ thể, hoặc sourceContent không đọc được, KHÔNG chặn
 * correlation chỉ vì thiếu dữ liệu audit — coi như khớp theo transactionHash là đủ.
 */
export function matchesSender(original: Transaction | null, payload: BlockchainMessagePayload): boolean {
  if (!original) {
    return true;
  }

  const declaredAddresses = extractDeclaredAddresses(original);

  if (declaredAddresses.length === 0) {
    return true;
  }

  const incomingAddresses = new Set(payload.senders.map((sender) => sender.address));

  return declaredAddresses.some((address) => incomingAddresses.has(address));
}
