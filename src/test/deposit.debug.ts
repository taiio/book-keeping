import { BLOCKCHAIN_TRANSACTION_STATUS } from '../constants';

import type { BlockchainMessagePayload } from '../interfaces';

import { BOOK, TEST_ACCOUNT, closeTestDatabase, createTestLedger } from './support/inMemoryLedger';

const TRANSACTION_HASH = '0xdeposit-debug-1';
const DEPOSIT_ADDRESS = 'addr-deposit-debug';
const QUANTITY = '1000';

function depositEvent(status: BlockchainMessagePayload['status']): BlockchainMessagePayload {
  return {
    transactionHash: TRANSACTION_HASH,
    status,

    senders: [
      {
        address: 'addr-external-sender',
        assetTicker: TEST_ACCOUNT.assetTicker,
        quantity: QUANTITY,
      },
    ],

    recipients: [
      {
        address: DEPOSIT_ADDRESS,
        assetTicker: TEST_ACCOUNT.assetTicker,
        quantity: QUANTITY,
        type: 'AMOUNT',
      },
    ],
  };
}

async function main() {
  const ledger = createTestLedger();

  try {
    console.log('\n========================================');
    console.log('DEPOSIT DEBUG');
    console.log('========================================\n');

    ledger.seedCustodyBook({
      address: DEPOSIT_ADDRESS,
      amount: '0',
    });

    // --------------------------------------------------
    // 1. CONFIRMING
    // --------------------------------------------------

    console.log('\n========== 1. CONFIRMING ==========\n');

    const confirming = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMING));

    console.log('\nEntity:');
    console.dir(confirming, { depth: null });

    console.log('\nJournals:');
    console.dir(ledger.tables.journals.rows, {
      depth: null,
    });

    console.log('\nJournal histories:');
    console.dir(ledger.tables.journalHistories.rows, { depth: null });

    console.log('\nBook postings:');
    console.dir(ledger.tables.bookPostings.rows, { depth: null });

    console.log('\nBook histories:');
    console.dir(ledger.tables.bookHistories.rows, { depth: null });

    console.log('\nBalances:');

    console.log('Custody:', ledger.amountOf(BOOK.custodyAvailable('BTC')));

    console.log('External:', ledger.amountOf(BOOK.external('BTC')));

    console.log('Total:', ledger.totalBalance());

    // --------------------------------------------------
    // 2. CONFIRMED
    // --------------------------------------------------

    console.log('\n========== 2. CONFIRMED ==========\n');

    const confirmed = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    console.log('\nEntity:');
    console.dir(confirmed, { depth: null });

    console.log('\nJournals:');
    console.dir(ledger.tables.journals.rows, {
      depth: null,
    });

    console.log('\nJournal histories:');
    console.dir(ledger.tables.journalHistories.rows, { depth: null });

    console.log('\nBook postings:');
    console.dir(ledger.tables.bookPostings.rows, { depth: null });

    console.log('\nBook histories:');
    console.dir(ledger.tables.bookHistories.rows, { depth: null });

    console.log('\nBalances:');

    console.log('Custody:', ledger.amountOf(BOOK.custodyAvailable('BTC')));

    console.log('External:', ledger.amountOf(BOOK.external('BTC')));

    console.log('Total:', ledger.totalBalance());

    // --------------------------------------------------
    // 3. DUPLICATE CONFIRMED
    // --------------------------------------------------

    console.log('\n========== 3. DUPLICATE CONFIRMED ==========\n');

    const duplicate = await ledger.blockchainEventHandler.handle(depositEvent(BLOCKCHAIN_TRANSACTION_STATUS.CONFIRMED));

    console.log('\nEntity:');
    console.dir(duplicate, { depth: null });

    console.log('\nJournals:');
    console.dir(ledger.tables.journals.rows, {
      depth: null,
    });

    console.log('\nJournal histories:');
    console.dir(ledger.tables.journalHistories.rows, { depth: null });

    console.log('\nBook postings:');
    console.dir(ledger.tables.bookPostings.rows, { depth: null });

    console.log('\nBook histories:');
    console.dir(ledger.tables.bookHistories.rows, { depth: null });

    console.log('\nBalances:');

    console.log('Custody:', ledger.amountOf(BOOK.custodyAvailable('BTC')));

    console.log('External:', ledger.amountOf(BOOK.external('BTC')));

    console.log('Total:', ledger.totalBalance());
  } catch (error) {
    console.error('\n========== ERROR ==========\n');

    console.error(error);

    if (error instanceof Error) {
      console.error('\nStack:\n');
      console.error(error.stack);
    }
  } finally {
    ledger.restore();
    await closeTestDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
