import type { BLOCKCHAIN_TRANSACTION_STATUS } from '../constants';
import type { Book } from '../models';
import type { Transaction } from './transaction';

export type BlockchainTransactionStatus = (typeof BLOCKCHAIN_TRANSACTION_STATUS)[keyof typeof BLOCKCHAIN_TRANSACTION_STATUS];

export interface BlockchainSender {
  address: string;
  assetTicker: string;
  quantity: string;
  feePaid?: string;
}

export interface DepositAccountIdentity {
  clientId: number;
  accountId: number;
  assetId: number;
  assetTypeId: number;
  walletTypeId: number;
}

export interface BlockchainRecipient {
  address: string;
  assetTicker: string;
  quantity: string;
  type: 'AMOUNT' | 'REWARD';

  account?: DepositAccountIdentity;
}

export interface BlockchainMessagePayload {
  transactionHash: string;

  idempotencyToken: string;
  blockNumber?: number;

  status: BlockchainTransactionStatus;

  senders: BlockchainSender[];

  recipients: BlockchainRecipient[];

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

export interface DepositBookMatch {
  book: Book;
  recipient: BlockchainRecipient;
}

export interface BlockchainSubmissionResult {
  transactionHash: string;
  senderAddress?: string;
}

export interface IBlockchainSubmitter {
  submit(transaction: Transaction, journalTransactionId: number): Promise<BlockchainSubmissionResult>;
}
