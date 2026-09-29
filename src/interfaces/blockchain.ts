import type { BlockchainTransactionStatusId, BookPostingPurposeId } from '../constants';
import type { Book } from '../models';
import type { FeeItem, Transaction } from './transaction';

export interface BlockchainSender {
  idempotencyToken?: string;
  address: string;
  assetTicker?: string;
  quantity?: string;
  feePaid?: string;
  account?: WithdrawalAccountIdentity;
}

export interface WithdrawalAccountIdentity {
  clientId: number;
  accountId: number;
  assetId: number;
  assetTicker: string;
  assetTypeId: number;
  walletTypeId: number;
}

export interface DepositAccountIdentity {
  clientId: number;
  accountId: number;
  assetId: number;
  assetTypeId: number;
  walletTypeId: number;
}

export interface BlockchainRecipient {
  idempotencyToken?: string;
  address: string;
  assetTicker: string;
  quantity: string;
  type?: BookPostingPurposeId;

  account?: DepositAccountIdentity;
}

export interface BlockchainMessagePayload {
  uuidToken?: string;
  transactionHash: string;
  blockNumber?: number;

  status: BlockchainTransactionStatusId;

  senders: BlockchainSender[];

  recipients: BlockchainRecipient[];

  networkFee: {
    idempotencyToken: string;
    payerAddress: string;
    assetTicker: string;
    quantity: string;
    account?: FeeItem;
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
