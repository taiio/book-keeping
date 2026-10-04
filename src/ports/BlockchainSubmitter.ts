import type { SystemTransaction } from '../types';

export interface BlockchainSubmissionResult {
  transactionHash: string;
  senderAddress?: string;
}

export interface IBlockchainSubmitter {
  submit(transaction: SystemTransaction, journalTransactionId: string): Promise<BlockchainSubmissionResult>;
}

export const BLOCKCHAIN_SUBMITTER = 'IBlockchainSubmitter';
