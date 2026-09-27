import { TransactionEntityBase } from './TransactionEntityBase';
import { WithdrawCommand } from './WithdrawCommand';
import { StakeCommand } from './StakeCommand';
import { UnstakeCommand } from './UnstakeCommand';
import { RestakeCommand } from './RestakeCommand';

export type TransactionEntity =
  | (WithdrawCommand & TransactionEntityBase)
  | (StakeCommand & TransactionEntityBase)
  | (UnstakeCommand & TransactionEntityBase)
  | (RestakeCommand & TransactionEntityBase);
