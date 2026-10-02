import type { SystemTransaction } from '../types';

export interface BlockchainSubmissionResult {
  transactionHash: string;
  senderAddress?: string;
}

/**
 * Puts a transaction on the blockchain.
 *
 * MUST be idempotent by `transaction.uuidToken`: the outbox relay delivers at least once, so the same transaction
 * can be submitted again, and that must yield the same hash instead of a second transfer.
 */
export interface IBlockchainSubmitter {
  submit(transaction: SystemTransaction, journalTransactionId: number): Promise<BlockchainSubmissionResult>;
}

export const BLOCKCHAIN_SUBMITTER = 'IBlockchainSubmitter';
