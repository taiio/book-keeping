import type { JournalTransactionStateId, TRANSACTION_TYPE, TransactionStateId } from '../constants';
import type { AccountItem, FeeItem } from './account';
import type { TransitionOutcome } from './ledger';

export interface PoolRef {
  poolId: string;
  address?: string;
}

export interface SystemTransactionBase {
  uuidToken: string;
  transactionHash?: string;
  transactionStateId: number;
}

export interface Withdraw extends SystemTransactionBase {
  type: typeof TRANSACTION_TYPE.WITHDRAW;
  sender: AccountItem[];
  recipient: AccountItem[];
  fee: FeeItem;
}

export interface Stake extends SystemTransactionBase {
  type: typeof TRANSACTION_TYPE.STAKE;
  sender: AccountItem;
  pool: PoolRef;
  fee: FeeItem;
}

export interface Unstake extends SystemTransactionBase {
  type: typeof TRANSACTION_TYPE.UNSTAKE;
  sender: AccountItem;
  pool: PoolRef;
  recipient: AccountItem[];
  fee: FeeItem;
}

export interface Restake extends SystemTransactionBase {
  type: typeof TRANSACTION_TYPE.RESTAKE;
  sender: AccountItem;
  fromPool: PoolRef;
  toPool: PoolRef;
  fee: FeeItem;
}

export type SystemTransaction = Withdraw | Stake | Unstake | Restake;

export interface SystemTransactionResult {
  uuidToken: string;
  /** False when nothing changed: the message was a replay or the transaction is already past that state. */
  processed: boolean;
  outcome: TransitionOutcome;
  transactionHash: string | null;
  senderJournalTransactionIds: number[];
  recipientJournalTransactionIds: number[];
}

export interface TransactionEntityBase {
  id: string;

  idempotencyToken: string;
  uuidToken: string;

  transactionStateId: TransactionStateId;

  journalTransactionState: JournalTransactionStateId;

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
