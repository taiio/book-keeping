import { AccountItem } from './AccountItem';
import { FeeItem } from './FeeItem';
import { TransactionCommandBase } from './TransactionCommandBase';

export interface StakeCommand extends TransactionCommandBase {
  type: 'STAKE';

  sender: AccountItem;

  pool: {
    poolId: string;
    address?: string;
  };

  fee: FeeItem;
}
