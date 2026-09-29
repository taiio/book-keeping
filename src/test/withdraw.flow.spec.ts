import 'reflect-metadata';
import { container } from 'tsyringe';

import { BOOK_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../../src/constants';
import { BookRepository } from '../../src/repositories/Book';
import { BlockchainEventHandler } from '../../src/handler/BlockchainEventHandler';
import { SystemTransactionHandler } from '../../src/handler/SystemTransactionHandler';
import { UnitOfWork } from '../../src/common/UnitOfWork';
import type { Withdraw } from '../../src/interfaces';
import type { BlockchainMessagePayload } from '../interfaces';
import { randomUUID } from 'crypto';
import { BLOCKCHAIN_SUBMITTER } from '../../src/handler/SystemTransactionHandler';
import type { IBlockchainSubmitter } from '../../src/interfaces';

const mockSubmitter: IBlockchainSubmitter = {
  async submit() {
    return { transactionHash: '0xWITHDRAW001' };
  },
};

async function main() {
  container.registerInstance(BLOCKCHAIN_SUBMITTER, mockSubmitter);
  const unitOfWork = container.resolve(UnitOfWork);
  const bookRepository = container.resolve(BookRepository);
  const systemTransactionHandler = container.resolve(SystemTransactionHandler);
  const blockchainEventHandler = container.resolve(BlockchainEventHandler);

  await unitOfWork.execute(async (tx) => {
    await bookRepository.getOrCreateBook(
      {
        name: BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.code,
        clientId: 1,
        accountId: 1,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        bookPurposeId: BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.id,
        transactionStateId: null,
        assetTicker: 'USDT',
      },
      tx,
    );
    await bookRepository.getOrCreateBook(
      {
        name: BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.code,
        clientId: 1,
        accountId: 1,
        assetTypeId: 2,
        walletTypeId: 1,
        assetId: 2,
        bookPurposeId: BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.id,
        transactionStateId: null,
        assetTicker: 'ETH',
      },
      tx,
    );
    for (const state of [
      TRANSACTION_STATE.AUTHORIZING,
      TRANSACTION_STATE.AUTHORIZED,
      TRANSACTION_STATE.SENT,
      TRANSACTION_STATE.CONFIRMING,
      TRANSACTION_STATE.CONFIRMED,
    ]) {
      await bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          clientId: 1,
          accountId: 1,
          assetTypeId: 1,
          walletTypeId: 1,
          assetId: 1,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          transactionStateId: state.id,
          assetTicker: 'USDT',
        },
        tx,
      );
    }

    for (const state of [
      TRANSACTION_STATE.AUTHORIZING,
      TRANSACTION_STATE.AUTHORIZED,
      TRANSACTION_STATE.SENT,
      TRANSACTION_STATE.CONFIRMING,
      TRANSACTION_STATE.CONFIRMED,
    ]) {
      await bookRepository.getOrCreateBook(
        {
          name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
          clientId: 1,
          accountId: 1,
          assetTypeId: 2,
          walletTypeId: 1,
          assetId: 2,
          bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
          transactionStateId: state.id,
          assetTicker: 'ETH',
        },
        tx,
      );
    }
  });

  const withdraw: Withdraw = {
    type: TRANSACTION_TYPE.WITHDRAW,
    uuidToken: 'withdraw-001',
    sender: [
      {
        idempotencyToken: 'sender002',
        clientId: 1,
        accountId: 1,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        assetTicker: 'USDT',
        quantity: '100',
        address: '0xInternalWallet',
      },
    ],
    recipient: [
      {
        idempotencyToken: 'recipient-002',
        assetId: 1,
        assetTicker: 'USDT',
        quantity: '100',
        address: '0xExternalRecipient',
      },
    ],
    fee: {
      idempotencyToken: 'fee-002',
      clientId: 1,
      accountId: 1,
      assetTypeId: 2,
      walletTypeId: 1,
      assetId: 2,
      assetTicker: 'ETH',
      quantity: '1',
    },
  };

  const result = await systemTransactionHandler.handle(withdraw);

  console.log('System transaction:', result);

  const payload: BlockchainMessagePayload = {
    uuidToken: withdraw.uuidToken,
    transactionHash: '0xWITHDRAW001',
    blockNumber: 200,
    status: TRANSACTION_STATE.CONFIRMING.id,
    senders: [
      {
        idempotencyToken: 'sender002',
        address: '0xInternalWallet',
        quantity: '100',
        account: {
          assetTicker: 'USDT',
          clientId: 1,
          accountId: 1,
          assetTypeId: 1,
          walletTypeId: 1,
          assetId: 1,
        },
      },
    ],
    recipients: [{ address: '0xExternalRecipient', assetTicker: 'USDT', quantity: '100' }],
    networkFee: {
      idempotencyToken: 'fee-002',
      payerAddress: '0xInternalWallet',
      assetTicker: 'ETH',
      quantity: '1',
      account: {
        idempotencyToken: 'fee-002',
        clientId: 1,
        accountId: 1,
        assetTypeId: 2,
        walletTypeId: 1,
        assetId: 2,
        assetTicker: 'ETH',
        quantity: '1',
      },
    },
  };

  await blockchainEventHandler.handle(payload);
  await blockchainEventHandler.handle({ ...payload, status: TRANSACTION_STATE.CONFIRMED.id });

  console.log('Withdraw flow completed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
