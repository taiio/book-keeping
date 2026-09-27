import { AccountItem } from './AccountItem';
import { FeeItem } from './FeeItem';
import { TransactionCommandBase } from './TransactionCommandBase';

export interface RestakeCommand extends TransactionCommandBase {
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
