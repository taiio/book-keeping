import { BlockchainSubmitterNotConfiguredError } from '../common/errors';
import type { IBlockchainSubmitter } from '../ports';

export class UnconfiguredBlockchainSubmitter implements IBlockchainSubmitter {
  async submit(): Promise<never> {
    throw new BlockchainSubmitterNotConfiguredError();
  }
}
