import type { JOURNAL_TRANSACTION_STATE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';

import type { TransactionStateId } from '../constants/transactionState';

// ----------------------------------------------------------------------
// Account / fee items
// ----------------------------------------------------------------------

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

// ----------------------------------------------------------------------
// State types
// ----------------------------------------------------------------------

export type JournalTransactionStateValue = (typeof JOURNAL_TRANSACTION_STATE)[keyof typeof JOURNAL_TRANSACTION_STATE];

// ----------------------------------------------------------------------
// System transactions
// ----------------------------------------------------------------------

export interface TransactionBase {
  /**
   * Idempotency token of the current business operation.
   *
   * Format:
   *
   *   transactionUuid:transactionType:transactionState:index
   */
  idempotencyToken: string;

  /**
   * Original business transaction UUID.
   */
  uuidToken: string;
}

export interface Withdraw extends TransactionBase {
  type: typeof TRANSACTION_TYPE.WITHDRAW;

  sender: AccountItem[];

  recipient: AccountItem[];

  fee: FeeItem;
}

export interface Stake extends TransactionBase {
  type: typeof TRANSACTION_TYPE.STAKE;

  sender: AccountItem;

  pool: {
    poolId: string;
    address?: string;
  };

  fee: FeeItem;
}

export interface Unstake extends TransactionBase {
  type: typeof TRANSACTION_TYPE.UNSTAKE;

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

// ----------------------------------------------------------------------
// Transaction entities
// ----------------------------------------------------------------------

export interface TransactionEntityBase {
  id: string;

  idempotencyToken: string;

  uuidToken: string;

  /**
   * Current transaction state.
   */
  state: TransactionStateId;

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

/**
 * DEPOSIT is not created by the system transaction handler.
 *
 * It is created from a blockchain event after the listener
 * identifies a system-owned deposit address.
 */
export interface DepositTransactionEntity extends TransactionEntityBase {
  type: typeof TRANSACTION_TYPE.DEPOSIT;

  recipient: AccountItem;
}

export type BlockchainDrivenEntity = TransactionEntity | DepositTransactionEntity;
