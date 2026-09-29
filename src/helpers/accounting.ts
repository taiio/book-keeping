import { BOOK_POSTING_PURPOSE } from '../constants';
import type { AccountingLegs, LegMovement, Transaction } from '../interfaces';

export function getAccountingLegs(transaction: Transaction): AccountingLegs {
  switch (transaction.type) {
    case 'WITHDRAW':
      return { debitItems: transaction.sender, creditItems: [], fee: transaction.fee };

    case 'STAKE':
      return { debitItems: [transaction.sender], creditItems: [], fee: transaction.fee };

    case 'UNSTAKE':
      return { debitItems: [], creditItems: transaction.recipient, fee: transaction.fee };

    case 'RESTAKE':
      return { debitItems: [], creditItems: [], fee: transaction.fee };

    default: {
      const exhaustiveCheck: never = transaction;
      throw new Error(`Unsupported transaction type: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

export function collectDebitAndFeeMovements(legs: AccountingLegs): LegMovement[] {
  return [
    ...legs.debitItems.map((item, index) => ({ key: `D${index}`, item, purposeId: BOOK_POSTING_PURPOSE.AMOUNT })),
    { key: 'FEE', item: legs.fee, purposeId: BOOK_POSTING_PURPOSE.FEE },
  ];
}

export function getAccountIds(transaction: Transaction): { fromAccountId?: number; toAccountId?: number } {
  switch (transaction.type) {
    case 'WITHDRAW':
      return { fromAccountId: transaction.sender[0]?.accountId, toAccountId: transaction.recipient[0]?.accountId };

    case 'STAKE':
      return { fromAccountId: transaction.sender.accountId, toAccountId: undefined };

    case 'UNSTAKE':
      return { fromAccountId: undefined, toAccountId: transaction.recipient[0]?.accountId };

    case 'RESTAKE':
      return { fromAccountId: transaction.sender.accountId, toAccountId: transaction.sender.accountId };

    default: {
      const exhaustiveCheck: never = transaction;
      throw new Error(`Unsupported transaction type: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
