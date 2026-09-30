import 'reflect-metadata';
import { container } from 'tsyringe';
import { randomBytes, randomInt, randomUUID } from 'crypto';

import { sequelize } from '../config/database';
import { TRANSACTION_STATE, TRANSACTION_TYPE } from '../constants';
import { BlockchainEventHandler } from '../handlers/BlockchainEventHandler';
import { SystemTransactionHandler } from '../handlers/SystemTransactionHandler';
import { BLOCKCHAIN_SUBMITTER } from '../ports';
import type { IBlockchainSubmitter } from '../ports';
import type { BlockchainMessagePayload, Withdraw } from '../types';

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
        address: senderAddress,
        assetTicker: 'USDT',
        quantity: '100',
        account: {
          clientId: 1,
          accountId: 1,
          assetTypeId: 1,
          walletTypeId: 1,
          assetId: 1,
        },
      },
    ],
    recipient: [
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
    fee: {
      idempotencyToken: idempotencyFee,
      assetTicker: 'ETH',
      quantity: '1',
      account: {
        clientId: 1,
        accountId: 1,
        assetTypeId: 2,
        walletTypeId: 1,
        assetId: 2,
      },
    },
  };

  await systemTransactionHandler.handle({ ...withdraw, transactionStateId: 1 });
  await systemTransactionHandler.handle({ ...withdraw, transactionStateId: 2 });
  await systemTransactionHandler.handle({ ...withdraw, transactionStateId: 3 });

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
        assetTicker: 'USDT',
        account: {
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
