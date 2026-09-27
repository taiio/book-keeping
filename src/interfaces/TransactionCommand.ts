import { WithdrawCommand } from './WithdrawCommand';
import { StakeCommand } from './StakeCommand';
import { UnstakeCommand } from './UnstakeCommand';
import { RestakeCommand } from './RestakeCommand';

export type TransactionCommand =
  | WithdrawCommand
  | StakeCommand
  | UnstakeCommand
  | RestakeCommand;
