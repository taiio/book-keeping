import type { JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE } from '../constants';
import type { JournalTransaction } from '../models';

export interface AccountItem {
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

export interface FeeItem {
  clientId?: number;
  accountId?: number;

  assetTypeId?: number;
  walletTypeId?: number;

  assetId: number;
  assetTicker: string;
  quantity: string;
}

export type JournalTransactionStateValue = (typeof JOURNAL_TRANSACTION_STATE)[keyof typeof JOURNAL_TRANSACTION_STATE];

export type TransactionStateCode = NonNullable<(typeof TRANSACTION_STATE)[keyof typeof TRANSACTION_STATE]['code']>;

export interface TransactionBase {
  idempotencyToken: string;
  uuidToken: string;
}

export interface Withdraw extends TransactionBase {
  type: 'WITHDRAW';
  sender: AccountItem[];
  recipient: AccountItem[];
  fee: FeeItem;
}

export interface Stake extends TransactionBase {
  type: 'STAKE';
  sender: AccountItem;
  pool: {
    poolId: string;
    address?: string;
  };
  fee: FeeItem;
}

export interface Unstake extends TransactionBase {
  type: 'UNSTAKE';
  sender: AccountItem;
  pool: {
    poolId: string;
    address?: string;
  };
  recipient: AccountItem[];
  fee: FeeItem;
}

export interface Restake extends TransactionBase {
  type: 'RESTAKE';
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

  state: TransactionStateCode;

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

export type TransactionEntity = Transaction & TransactionEntityBase;

export interface DepositTransactionEntity extends TransactionEntityBase {
  type: 'DEPOSIT';
  recipient: AccountItem;
}

export type BlockchainDrivenEntity = TransactionEntity | DepositTransactionEntity;

export type AuthorizePhase = 'AUTHORIZED' | 'REJECTED' | 'REPLAYED';

export interface AuthorizeResult {
  phase: AuthorizePhase;
  journalTransaction: JournalTransaction;
  transactionStateId: number | null;
  errorMessage?: string;
}
