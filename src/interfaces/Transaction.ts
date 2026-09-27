import { Withdraw } from './Withdraw';
import { Stake } from './Stake';
import { Unstake } from './Unstake';
import { Restake } from './Restake';

export type Transaction =
  | Withdraw
  | Stake
  | Unstake
  | Restake;
