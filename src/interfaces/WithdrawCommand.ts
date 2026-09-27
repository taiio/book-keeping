import { AccountItem } from './AccountItem';
import { FeeItem } from './FeeItem';
import { TransactionCommandBase } from './TransactionCommandBase';

export interface WithdrawCommand extends TransactionCommandBase {
  type: 'WITHDRAW';

  sender: AccountItem[];

  recipient: AccountItem[];

  fee: FeeItem;
}