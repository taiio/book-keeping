import { AccountItem } from './AccountItem';
import { FeeItem } from './FeeItem';
import { TransactionCommandBase } from './TransactionCommandBase';

export interface UnstakeCommand extends TransactionCommandBase {
  type: 'UNSTAKE';

  sender: AccountItem;

  pool: {
    poolId: string;
    address?: string;
  };

  recipient: AccountItem[];

  fee: FeeItem;
}
