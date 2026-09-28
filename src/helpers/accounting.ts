import { BOOK_POSTING_PURPOSE } from '../constants';
import type { AccountingLegs, LegMovement, Transaction } from '../interfaces';

/**
 * Ngữ nghĩa kế toán theo từng loại transaction — phần DUY NHẤT khác nhau giữa
 * WITHDRAW/STAKE/UNSTAKE/RESTAKE; mọi thứ còn lại dùng chung 1 pipeline.
 */
export function getAccountingLegs(transaction: Transaction): AccountingLegs {
  switch (transaction.type) {
    case 'WITHDRAW':
      return { debitItems: transaction.sender, creditItems: [], fee: transaction.fee };

    case 'STAKE':
      return { debitItems: [transaction.sender], creditItems: [], fee: transaction.fee };

    case 'UNSTAKE':
      // Gốc stake được unstake nằm ở pool bên ngoài (không phải custody book) nên
      // không có vế debit cho principal — chỉ có vế credit khi tiền được trả về custody.
      return { debitItems: [], creditItems: transaction.recipient, fee: transaction.fee };

    case 'RESTAKE':
      // fromPool -> toPool là chuyển pool-to-pool hoàn toàn bên ngoài custody;
      // chỉ có fee ảnh hưởng tới custody của client.
      return { debitItems: [], creditItems: [], fee: transaction.fee };

    default: {
      const exhaustiveCheck: never = transaction;
      throw new Error(`Unsupported transaction type: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/** Các vế rời custody (debit) + fee — fee LUÔN là 1 movement độc lập với amount chính. */
export function collectDebitAndFeeMovements(legs: AccountingLegs): LegMovement[] {
  return [
    ...legs.debitItems.map((item, index) => ({ key: `D${index}`, item, purposeId: BOOK_POSTING_PURPOSE.AMOUNT })),
    { key: 'FEE', item: legs.fee, purposeId: BOOK_POSTING_PURPOSE.FEE },
  ];
}
