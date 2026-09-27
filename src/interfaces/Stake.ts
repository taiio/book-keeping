import { AccountItem } from './AccountItem';
import { FeeItem } from './FeeItem';
import { TransactionBase } from './TransactionBase';

export interface Stake extends TransactionBase {
  type: 'STAKE';

  sender: AccountItem;

  pool: {
    poolId: string;
    address?: string;
  };

  fee: FeeItem;
}
