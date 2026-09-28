import { BLOCKCHAIN_TRANSACTION_STATUS } from '../constants';

import type { BlockchainMessagePayload } from '../interfaces';

import { sequelize } from '../config/database';

// TODO: đổi path/class này theo project của bạn
import { BlockchainEventHandler } from '../handler/BlockchainEventHandler';

const TRANSACTION_HASH = '0xdeposit-debug-1';
const DEPOSIT_ADDRESS = 'addr-deposit-1';
const QUANTITY = '1000';

function createDepositEvent(status: BlockchainMessagePayload['status']): BlockchainMessagePayload {
  return {
    transactionHash: TRANSACTION_HASH,

    status,

    senders: [
      {
        address: 'addr-external-sender',
        assetTicker: 'BTC',
        quantity: QUANTITY,
      },
    ],

    recipients: [
      {
        address: DEPOSIT_ADDRESS,
        assetTicker: 'BTC',
        quantity: QUANTITY,
        type: 'AMOUNT',
      },
    ],
  };
}

async function main() {
  try {
    await sequelize.authenticate();

    console.log('Database connected.');

    // Khởi tạo class thật của application.
    const blockchainEventHandler = new BlockchainEventHandler();

    // --------------------------------------------------
    // 1. CONFIRMING
    // --------------------------------------------------

    console.log('\n========== CONFIRMING ==========\n');

    const confirming = await blockchainEventHandler.handle(createDepositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    console.dir(confirming, {
      depth: null,
    });

    // --------------------------------------------------
    // 2. CONFIRMED
    // --------------------------------------------------

    console.log('\n========== CONFIRMED ==========\n');

    const confirmed = await blockchainEventHandler.handle(createDepositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    console.dir(confirmed, {
      depth: null,
    });

    // --------------------------------------------------
    // 3. DUPLICATE CONFIRMED
    // --------------------------------------------------

    console.log('\n========== DUPLICATE CONFIRMED ==========\n');

    const duplicate = await blockchainEventHandler.handle(createDepositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    console.dir(duplicate, {
      depth: null,
    });
  } catch (error) {
    console.error('\nERROR:\n');

    console.error(error);

    if (error instanceof Error) {
      console.error(error.stack);
    }
  } finally {
    await sequelize.close();
  }
}

main();
