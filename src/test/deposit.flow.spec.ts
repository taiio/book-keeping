import 'reflect-metadata';
import { container } from 'tsyringe';

import { randomBytes, randomInt, randomUUID } from 'crypto';

import { sequelize } from '../config/database';
import { BOOK_POSTING_PURPOSE, TRANSACTION_STATE } from '../constants';
import { BlockchainEventHandler } from '../handlers/BlockchainEventHandler';
import type { BlockchainMessagePayload } from '../types';

async function main() {
  const blockchainEventHandler = container.resolve(BlockchainEventHandler);

  {
    const payload: BlockchainMessagePayload = {
      uuidToken: randomUUID(),
      transactionHash: randomBytes(32).toString('hex'),
      blockNumber: randomInt(10000),
      status: TRANSACTION_STATE.CONFIRMING.id,
      senders: [{ address: randomBytes(12).toString('hex'), assetTicker: 'USDT', quantity: '1000' }],
      recipients: [
        {
          idempotencyToken: randomUUID(),
          address: randomBytes(16).toString('hex'),
          assetTicker: 'USDT',
          quantity: '1000',
          type: BOOK_POSTING_PURPOSE.AMOUNT,
          account: { clientId: 1, accountId: 1, assetTypeId: 1, walletTypeId: 1, assetId: 1 },
        },
        {
          idempotencyToken: randomUUID(),
          address: randomBytes(16).toString('hex'),

          assetTicker: 'ETH',
          quantity: '10',
          account: { clientId: 1, accountId: 1, assetTypeId: 2, walletTypeId: 1, assetId: 2 },
        },
        {
          idempotencyToken: randomUUID(),
          address: randomBytes(16).toString('hex'),

          assetTicker: 'ETH',
          quantity: '10',
          account: { clientId: 1, accountId: 3, assetTypeId: 2, walletTypeId: 1, assetId: 30 },
        },
      ],
      networkFee: {
        idempotencyToken: randomUUID(),
        payerAddress: randomBytes(12).toString('hex'),
        assetTicker: 'ETH',
        quantity: '1',
      },
    };

    await blockchainEventHandler.handle(payload);
    await blockchainEventHandler.handle({ ...payload, status: TRANSACTION_STATE.CONFIRMED.id });

    console.log('Deposit flow completed');
  }
  await sequelize.close();
}
main().catch((error) => {
  console.error(error);
  process.exit(1);
});
