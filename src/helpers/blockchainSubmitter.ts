import type { BlockchainSubmissionResult, IBlockchainSubmitter } from '../interfaces';

/** Null-object cho `SystemTransactionHandler.blockchainSubmitter` cho tới khi tầng ngoài gán implementation thật. */
export const NOT_WIRED_SUBMITTER: IBlockchainSubmitter = {
  async submit(): Promise<BlockchainSubmissionResult> {
    throw new Error(
      'IBlockchainSubmitter chưa được wiring cho SystemTransactionHandler. ' +
        'Gán implementation thật vào `systemTransactionHandler.blockchainSubmitter` trước khi dùng.',
    );
  },
};
