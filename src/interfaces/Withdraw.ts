import { AccountItem } from './AccountItem';
import { FeeItem } from './FeeItem';
import { TransactionBase } from './TransactionBase';

export interface Withdraw extends TransactionBase {
  type: 'WITHDRAW';

  sender: AccountItem[];

  recipient: AccountItem[];

  fee: FeeItem;
}