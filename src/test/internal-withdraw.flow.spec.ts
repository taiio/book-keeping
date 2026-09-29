import 'reflect-metadata';
import { container } from 'tsyringe';
import { BOOK_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../../src/constants';
import { BookRepository } from '../../src/repositories/Book';
import { BlockchainEventHandler } from '../../src/handler/BlockchainEventHandler';
import { SystemTransactionHandler, BLOCKCHAIN_SUBMITTER } from '../../src/handler/SystemTransactionHandler';
import { UnitOfWork } from '../../src/common/UnitOfWork';
import type { IBlockchainSubmitter, Withdraw } from '../../src/interfaces';
import type { BlockchainMessagePayload } from '../interfaces';

const mockSubmitter: IBlockchainSubmitter = {
  async submit() {
    return { transactionHash: '0xinternalWITHDRAW001' };
  },
};

async function main() {
  container.registerInstance(BLOCKCHAIN_SUBMITTER, mockSubmitter);
  const unitOfWork = container.resolve(UnitOfWork);
  const bookRepository = container.resolve(BookRepository);
  const systemTransactionHandler = container.resolve(SystemTransactionHandler);
  const blockchainEventHandler = container.resolve(BlockchainEventHandler);

  await unitOfWork.execute(async (tx) => {
    await bookRepository.initBalance(
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
        amount: '-1000',
        lastSequenceNo: 0,
      },
      tx,
    );
    await bookRepository.initBalance(
      {
        name: BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.code,
        clientId: 1,
        accountId: 2,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        bookPurposeId: BOOK_PURPOSE.BLOCKCHIAN_EXTERNAL_ACCOUNT.id,
        transactionStateId: null,
        assetTicker: 'USDT',
        amount: '-1000',
        lastSequenceNo: 0,
      },
      tx,
    );
    await bookRepository.initBalance(
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
        amount: '-1000',
        lastSequenceNo: 0,
      },
      tx,
    );

    for (const account of [
      { accountId: 1, assetTypeId: 1, assetId: 1, assetTicker: 'USDT' },
      { accountId: 2, assetTypeId: 1, assetId: 1, assetTicker: 'USDT' },
      { accountId: 1, assetTypeId: 2, assetId: 2, assetTicker: 'ETH' },
    ]) {
      for (const state of [
        TRANSACTION_STATE.AUTHORIZING,
        TRANSACTION_STATE.AUTHORIZED,
        TRANSACTION_STATE.SENT,
        TRANSACTION_STATE.CONFIRMING,
        TRANSACTION_STATE.CONFIRMED,
      ]) {
        await bookRepository.initBalance(
          {
            name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
            clientId: 1,
            accountId: account.accountId,
            assetTypeId: account.assetTypeId,
            walletTypeId: 1,
            assetId: account.assetId,
            bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
            transactionStateId: state.id,
            assetTicker: account.assetTicker,
            amount: state === TRANSACTION_STATE.CONFIRMED ?'1000': '0',
            lastSequenceNo: 0,
          },
          tx,
        );
      }
    }
  });

  const withdraw: Withdraw = {
    type: TRANSACTION_TYPE.WITHDRAW,
    uuidToken: 'withdraw-internal-001',
    transactionHash: '0xinternalWITHDRAW001',
    sender: [
      {
        idempotencyToken: 'sender-internal-001',
        clientId: 1,
        accountId: 1,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        assetTicker: 'USDT',
        quantity: '100',
        address: '0xWalletAccount1',
      },
    ],
    recipient: [
      {
        idempotencyToken: 'recipient-internal-001',
        clientId: 1,
        accountId: 2,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        assetTicker: 'USDT',
        quantity: '100',
        address: '0xWalletAccount2',
      },
    ],
    fee: {
      idempotencyToken: 'fee-internal-001',
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
    transactionHash: '0xinternalWITHDRAW001',
    blockNumber: 200,
    status: TRANSACTION_STATE.CONFIRMING.id,
    senders: [
      {
        idempotencyToken: 'sender-internal-001',
        address: '0xWalletAccount1',
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
    recipients: [
      {
        idempotencyToken: 'recipient-internal-001',
        address: '0xWalletAccount2',
        assetTicker: 'USDT',
        quantity: '100',
        account: {
          clientId: 1,
          accountId: 2,
          assetTypeId: 1,
          walletTypeId: 1,
          assetId: 1,
        },
      },
    ],
    networkFee: {
      idempotencyToken: 'fee-internal-001',
      payerAddress: '0xWalletAccount1',
      assetTicker: 'ETH',
      quantity: '1',
      account: {
        idempotencyToken: 'fee-internal-001',
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

  console.log('Internal withdraw flow completed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
