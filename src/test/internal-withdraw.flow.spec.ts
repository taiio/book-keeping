import 'reflect-metadata';
import { container } from 'tsyringe';
import { BOOK_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../../src/constants';
import { BookRepository } from '../../src/repositories/Book';
import { BlockchainEventHandler } from '../../src/handler/BlockchainEventHandler';
import { SystemTransactionHandler, BLOCKCHAIN_SUBMITTER } from '../../src/handler/SystemTransactionHandler';
import { UnitOfWork } from '../../src/common/UnitOfWork';
import type { IBlockchainSubmitter, Withdraw } from '../../src/interfaces';
import type { BlockchainMessagePayload } from '../interfaces';
import { randomBytes, randomInt, randomUUID } from 'crypto';
import { sequelize } from '../config/database';

const transactionHash = randomBytes(32).toString('hex');
const mockSubmitter: IBlockchainSubmitter = {
  async submit() {
    return { transactionHash };
  },
};

async function main() {
  container.registerInstance(BLOCKCHAIN_SUBMITTER, mockSubmitter);
  const systemTransactionHandler = container.resolve(SystemTransactionHandler);
  const blockchainEventHandler = container.resolve(BlockchainEventHandler);
  const uuidToken = randomUUID();
  const senderAddress = '66f83428e0f1dd12d40933d9ed081bab3';
  const recipentAddress1 = '66f83428e0f1dd12d40933d9ed081bab4';
  const recipentAddress2 = '66f83428e0f1dd12d40933d9ed081bab5';
  const idempotencySender = randomUUID();
  const idempotencyRecipent1 = randomUUID();
  const idempotencyRecipent2 = randomUUID();
  const idempotencyFee = randomUUID();
  const withdraw: Withdraw = {
    type: TRANSACTION_TYPE.WITHDRAW,
    transactionStateId: 1,
    uuidToken,
    transactionHash,
    sender: [
      {
        idempotencyToken: idempotencySender,
        clientId: 1,
        accountId: 1,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        assetTicker: 'USDT',
        quantity: '100',
        address: senderAddress,
      },
    ],
    recipient: [
      {
        idempotencyToken: idempotencyRecipent1,
        clientId: 1,
        accountId: 2,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        assetTicker: 'USDT',
        quantity: '50',
        address: recipentAddress1,
      },
      {
        idempotencyToken: idempotencyRecipent2,
        clientId: 1,
        accountId: 3,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        assetTicker: 'USDT',
        quantity: '50',
        address: recipentAddress2,
      },
    ],
    fee: {
      idempotencyToken: idempotencyFee,
      clientId: 1,
      accountId: 1,
      assetTypeId: 2,
      walletTypeId: 1,
      assetId: 2,
      assetTicker: 'ETH',
      quantity: '1',
    },
  };

await systemTransactionHandler.handle({...withdraw, transactionStateId: 1});
await systemTransactionHandler.handle({...withdraw, transactionStateId: 2})
await systemTransactionHandler.handle({...withdraw, transactionStateId: 3})

  const payload: BlockchainMessagePayload = {
    uuidToken: withdraw.uuidToken,
    transactionHash: transactionHash,
    blockNumber: randomInt(1000000),
    status: TRANSACTION_STATE.CONFIRMING.id,
    senders: [
      {
        idempotencyToken: idempotencySender,
        address: senderAddress,
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
        idempotencyToken: idempotencyRecipent1,
        address: recipentAddress1,
        assetTicker: 'USDT',
        quantity: '50',
        account: {
          clientId: 1,
          accountId: 2,
          assetTypeId: 1,
          walletTypeId: 1,
          assetId: 1,
        },
      },
      {
        idempotencyToken: idempotencyRecipent2,
        address: recipentAddress2,
        assetTicker: 'USDT',
        quantity: '50',
        account: {
          clientId: 1,
          accountId: 3,
          assetTypeId: 1,
          walletTypeId: 1,
          assetId: 1,
        },
      },
    ],
    networkFee: {
      idempotencyToken: idempotencyFee,
      payerAddress: senderAddress,
      assetTicker: 'ETH',
      quantity: '1',
      account: {
        idempotencyToken: idempotencyFee,
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
  await sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
