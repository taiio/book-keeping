import { AccountItem } from './AccountItem';
import { FeeItem } from './FeeItem';
import { TransactionBase } from './TransactionBase';

export interface Unstake extends TransactionBase {
  type: 'UNSTAKE';

  sender: AccountItem;

  pool: {
    poolId: string;
    address?: string;
  };

  recipient: AccountItem[];

  fee: FeeItem;
}
