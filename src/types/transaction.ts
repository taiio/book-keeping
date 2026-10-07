import type { TRANSACTION_TYPE, TransitionOutcome } from '../constants';
import type { JournalTransaction } from '../models';
import type { AccountItem, FeeItem } from './account';
import type { TransitionResult } from './ledger';

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

export interface WithdrawJournalTransactions {
  senders: JournalTransaction[];
  recipients: JournalTransaction[];
  results: TransitionResult[];
}

export interface SystemTransactionResult {
  uuidToken: string;
  processed: boolean;
  outcome: TransitionOutcome;
  transactionHash: string | null;
  senderJournalTransactionIds: string[];
  recipientJournalTransactionIds: string[];
}
