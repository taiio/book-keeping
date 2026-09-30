import type { JOURNAL_TRANSACTION_STATE, TRANSACTION_TYPE, TransactionStateId } from '../constants';

export interface AccountItem {
  idempotencyToken: string;

  clientId?: number;
  accountId?: number;

  assetTypeId?: number;
  walletTypeId?: number;

  assetId: number;
  assetTicker: string;
  quantity: string;

  poolId?: string;
  address?: string;
}

/**
 * Minimal identity + asset shape needed to resolve a Book. Both AccountItem and FeeItem satisfy it.
 */
export type LegItem = Pick<AccountItem, 'clientId' | 'accountId' | 'assetTypeId' | 'walletTypeId' | 'assetId' | 'assetTicker'>;

export interface FeeItem {
  idempotencyToken: string;

  clientId: number;
  accountId: number;

  assetTypeId: number;
  walletTypeId: number;

  assetId: number;
  assetTicker: string;
  quantity: string;
}

export type JournalTransactionStateValue = (typeof JOURNAL_TRANSACTION_STATE)[keyof typeof JOURNAL_TRANSACTION_STATE];

export interface TransactionBase {
  uuidToken: string;
  transactionHash?: string;
}

export interface Withdraw extends TransactionBase {
  type: typeof TRANSACTION_TYPE.WITHDRAW;
  transactionStateId: number;
  sender: AccountItem[];
  recipient: AccountItem[];
  fee: FeeItem;
}

export interface Stake extends TransactionBase {
  type: typeof TRANSACTION_TYPE.STAKE;
  transactionStateId: number;
  sender: AccountItem;
  pool: {
    poolId: string;
    address?: string;
  };
  fee: FeeItem;
}

export interface Unstake extends TransactionBase {
  type: typeof TRANSACTION_TYPE.UNSTAKE;
  transactionStateId: number;
  sender: AccountItem;
  pool: {
    poolId: string;
    address?: string;
  };
  recipient: AccountItem[];
  fee: FeeItem;
}

export interface Restake extends TransactionBase {
  type: typeof TRANSACTION_TYPE.RESTAKE;
  transactionStateId: number;
  sender: AccountItem;
  fromPool: {
    poolId: string;
    address?: string;
  };
  toPool: {
    poolId: string;
    address?: string;
  };
  fee: FeeItem;
}

export type Transaction = Withdraw | Stake | Unstake | Restake;

export interface TransactionEntityBase {
  id: string;

  idempotencyToken: string;
  uuidToken: string;

  transactionStateId: TransactionStateId;

  journalTransactionState: JournalTransactionStateValue;

  transactionHash?: string;
  blockNumber?: number;

  errorCode?: string | number;
  errorMessage?: string;

  consumedFee?: {
    payerAddress?: string;
    assetTicker?: string;
    quantity: string;
  };

  createdAt: Date;
  updatedAt: Date;
}
