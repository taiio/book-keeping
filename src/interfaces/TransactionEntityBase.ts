import { TransactionState } from './TransactionState';

export interface TransactionEntityBase {
  id: string;

  idempotencyToken: string;
  uuidToken: string;

  state: TransactionState;

  transactionHash?: string;
  blockNumber?: number;

  errorCode?: string | number;
  errorMessage?: string;

  consumedFee?: {
    payerAddress?: string;
    assetTicker?: string;
    quantity: string;
  };

  createdAt: Date;
  updatedAt: Date;
}
