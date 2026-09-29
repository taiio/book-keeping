import type { Transaction } from 'sequelize';
import type { AccountItem, IBlockchainSubmitter, LedgerLeg, Withdraw } from '.';
import type { JournalTransaction } from '../models';

export interface SystemTransactionResult {
  uuidToken: string;
  processed: boolean;
  transactionHash: string | null;
  senderJournalTransactionIds: number[];
  recipientJournalTransactionIds: number[];
}

export type UnitOfWorkTransaction = Transaction;

export interface SenderJournalTransactionInput {
  withdraw: Withdraw;
  tx: UnitOfWorkTransaction;
}

export interface RecipientJournalTransactionInput {
  withdraw: Withdraw;
  tx: UnitOfWorkTransaction;
}

export interface SenderTransitionRequest {
  journalTransaction: JournalTransaction;
  targetStateId: number;
  legs: LedgerLeg[];
}

export type BlockchainSubmitter = IBlockchainSubmitter;

export function isInternalRecipient(item: AccountItem): boolean {
  return item.clientId !== undefined && item.accountId !== undefined && item.assetTypeId !== undefined && item.walletTypeId !== undefined;
}
