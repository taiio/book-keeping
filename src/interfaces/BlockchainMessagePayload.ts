import { BlockchainTransactionStatus } from './BlockchainTransactionStatus';


// Here, we can to know this transaction have deposit, withdraw, stake,...  I think we can to check transactionHash to JournalTransaction table
// to know the exactly the transaction type.
export interface BlockchainMessagePayload {
  transactionHash: string;

  blockNumber?: number;

  status: BlockchainTransactionStatus;

  senders: {
    address: string;
    assetTicker: string;
    quantity: string;
    feePaid?: string;
  }[];

  recipients: {
    address: string;
    assetTicker: string;
    quantity: string;
    type: 'AMOUNT' | 'REWARD';
  }[];

  networkFee?: {
    payerAddress: string;
    assetTicker: string;
    quantity: string;
  };

  error?: {
    code?: string | number;
    message: string;
  };
}
