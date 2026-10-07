import { Kafka } from 'kafkajs';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const kafka = new Kafka({
  clientId: 'bookkeeping-script',
  brokers: ['localhost:9094'],
});

const producer = kafka.producer();

const SYSTEM_TOPIC = 'bookkeeping.system-transactions';
const BLOCKCHAIN_TOPIC = 'bookkeeping.blockchain-events';

const TRANSACTION_STATE = {
  CONFIRMING: {
    id: 5,
  },
};

const BOOK_POSTING_PURPOSE = {
  AMOUNT: 1,
  FEE: 2,
  REWARD: 3,
};

function createBlockchainPayload() {
  return {
    uuidToken: randomUUID(),
    eventId: randomUUID(),
    transactionHash: randomBytes(32).toString('hex'),

    blockNumber: randomInt(10000),

    status: TRANSACTION_STATE.CONFIRMING.id,

    senders: [
      {
        address: randomBytes(12).toString('hex'),
        assetTicker: 'USDT',
        quantity: '1000',
      },
    ],

    recipients: [
      {
        idempotencyToken: randomUUID(),
        address: randomBytes(16).toString('hex'),
        assetTicker: 'USDT',
        quantity: '1000',
        type: BOOK_POSTING_PURPOSE.AMOUNT,

        account: {
          clientId: 1,
          accountId: 1,
          assetTypeId: 1,
          walletTypeId: 1,
          assetId: 1,
        },
      },

      {
        idempotencyToken: randomUUID(),
        address: randomBytes(16).toString('hex'),
        assetTicker: 'ETH',
        quantity: '10',
        type: BOOK_POSTING_PURPOSE.AMOUNT,

        account: {
          clientId: 1,
          accountId: 1,
          assetTypeId: 2,
          walletTypeId: 1,
          assetId: 2,
        },
      },

      {
        idempotencyToken: randomUUID(),
        address: randomBytes(16).toString('hex'),
        assetTicker: 'ETH',
        quantity: '10',
        type: BOOK_POSTING_PURPOSE.AMOUNT,

        account: {
          clientId: 1,
          accountId: 3,
          assetTypeId: 2,
          walletTypeId: 1,
          assetId: 30,
        },
      },
    ],

    networkFee: {
      idempotencyToken: randomUUID(),
      payerAddress: randomBytes(12).toString('hex'),
      assetTicker: 'ETH',
      quantity: '1',
    },
  };
}

function createSystemPayload() {
  return {
    uuidToken: randomUUID(),

    transactionType: 'WITHDRAW',

    amount: {
      assetTicker: 'USDT',
      quantity: '1000',
    },

    sender: {
      clientId: 1,
      accountId: 1,
      assetTypeId: 1,
      walletTypeId: 1,
      assetId: 1,
    },

    recipient: {
      clientId: 1,
      accountId: 3,
      assetTypeId: 1,
      walletTypeId: 1,
      assetId: 1,
    },
  };
}

async function main() {
  await producer.connect();

  try {
    // ==========================================================
    // 1. Blockchain event
    // ==========================================================

    const blockchainPayload = createBlockchainPayload();

    await producer.send({
      topic: BLOCKCHAIN_TOPIC,

      messages: [
        {
          key: blockchainPayload.transactionHash,
          value: JSON.stringify(blockchainPayload),
        },
      ],
    });

    console.log('\n[Kafka] Published blockchain event:', BLOCKCHAIN_TOPIC);

    console.dir(blockchainPayload, {
      depth: null,
    });

    // // ==========================================================
    // // 2. System transaction
    // // ==========================================================

    // const systemPayload = createSystemPayload();

    // await producer.send({
    //   topic: SYSTEM_TOPIC,

    //   messages: [
    //     {
    //       key: systemPayload.uuidToken,
    //       value: JSON.stringify(systemPayload),
    //     },
    //   ],
    // });

    // console.log('\n[Kafka] Published system transaction:', SYSTEM_TOPIC);

    // console.dir(systemPayload, {
    //   depth: null,
    // });
  } finally {
    await producer.disconnect();
  }
}

main().catch((error) => {
  console.error('[Kafka] Failed to publish messages:', error);
  process.exit(1);
});
