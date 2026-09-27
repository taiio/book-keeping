import { TransactionEntityBase } from './TransactionEntityBase';
import { Withdraw } from './Withdraw';
import { Stake } from './Stake';
import { Unstake } from './Unstake';
import { Restake } from './Restake';

export type TransactionEntity =
  | (Withdraw & TransactionEntityBase)
  | (Stake & TransactionEntityBase)
  | (Unstake & TransactionEntityBase)
  | (Restake & TransactionEntityBase);
