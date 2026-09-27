import { AccountItem } from './AccountItem';
import { FeeItem } from './FeeItem';
import { TransactionBase } from './TransactionBase';

export interface Restake extends TransactionBase {
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
