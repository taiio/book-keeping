import { Kafka } from 'kafkajs';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const kafka = new Kafka({
  clientId: 'bookkeeping-script',
  brokers: ['localhost:9094'],
});

const producer = kafka.producer();

const BLOCKCHAIN_TOPIC = 'bookkeeping.blockchain-events';

const TRANSACTION_STATE = {
  CONFIRMING: 4,
  CONFIRMED: 5,
} as const;

const BOOK_POSTING_PURPOSE = {
  AMOUNT: 1,
  FEE: 2,
  REWARD: 3,
} as const;

const transaction = {
  uuidToken: randomUUID(),
  transactionHash: randomBytes(32).toString('hex'),

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

async function main() {
  await producer.connect();

  try {
    // CONFIRMING
    const confirmingEvent = {
      ...transaction,
      eventId: randomUUID(),
      blockNumber: randomInt(10000),
      status: TRANSACTION_STATE.CONFIRMING,
    };

    // CONFIRMED
    const confirmedEvent = {
      ...transaction,
      eventId: randomUUID(),
      blockNumber: confirmingEvent.blockNumber,
      status: TRANSACTION_STATE.CONFIRMED,
    };

    await producer.send({
      topic: BLOCKCHAIN_TOPIC,
      messages: [
        {
          key: transaction.transactionHash,
          value: JSON.stringify(confirmingEvent),
        },
        {
          key: transaction.transactionHash,
          value: JSON.stringify(confirmedEvent),
        },
      ],
    });

    console.log(`\n[Kafka] Published events: ${BLOCKCHAIN_TOPIC}`);

    console.log('\n[CONFIRMING]');
    console.dir(confirmingEvent, { depth: null });

    console.log('\n[CONFIRMED]');
    console.dir(confirmedEvent, { depth: null });
  } finally {
    await producer.disconnect();
  }
}

main().catch((error) => {
  console.error('[Kafka] Failed to publish messages:', error);
  process.exit(1);
});
