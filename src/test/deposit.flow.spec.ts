import 'reflect-metadata';
import { container } from 'tsyringe';

import { BOOK_POSTING_PURPOSE, BOOK_PURPOSE, TRANSACTION_STATE } from '../../src/constants';
import { BookRepository } from '../../src/repositories/Book';
import { BlockchainEventHandler } from '../../src/handler/BlockchainEventHandler';
import { UnitOfWork } from '../../src/common/UnitOfWork';
import { BlockchainMessagePayload } from '../interfaces';

async function main() {
  const unitOfWork = container.resolve(UnitOfWork);
  const bookRepository = container.resolve(BookRepository);
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
        name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
        clientId: 1,
        accountId: 1,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        transactionStateId: TRANSACTION_STATE.AUTHORIZING.id,
        assetTicker: 'USDT',
      },
      tx,
    );
    await bookRepository.getOrCreateBook(
      {
        name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
        clientId: 1,
        accountId: 1,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        transactionStateId: TRANSACTION_STATE.AUTHORIZED.id,
        assetTicker: 'USDT',
      },
      tx,
    );
    await bookRepository.getOrCreateBook(
      {
        name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
        clientId: 1,
        accountId: 1,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        transactionStateId: TRANSACTION_STATE.SENT.id,
        assetTicker: 'USDT',
      },
      tx,
    );
    await bookRepository.getOrCreateBook(
      {
        name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
        clientId: 1,
        accountId: 1,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        transactionStateId: TRANSACTION_STATE.CONFIRMING.id,
        assetTicker: 'USDT',
      },
      tx,
    );
    await bookRepository.getOrCreateBook(
      {
        name: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.code,
        clientId: 1,
        accountId: 1,
        assetTypeId: 1,
        walletTypeId: 1,
        assetId: 1,
        bookPurposeId: BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id,
        transactionStateId: TRANSACTION_STATE.CONFIRMED.id,
        assetTicker: 'USDT',
      },
      tx,
    );
  });

  const payload: BlockchainMessagePayload = {
    uuidToken: 'deposit-001',
    transactionHash: '0xDEPOSIT001',
    blockNumber: 100,
    status: TRANSACTION_STATE.CONFIRMING.id,
    senders: [{ address: '0xExternalSender' }],
    recipients: [
      {
        idempotencyToken: 'deposit-001-account-1',
        address: '0xInternalWallet',
        assetTicker: 'USDT',
        quantity: '100',
        type: BOOK_POSTING_PURPOSE.AMOUNT,
        account: { clientId: 1, accountId: 1, assetTypeId: 1, walletTypeId: 1, assetId: 1 },
      },
    ],
    networkFee: {
      idempotencyToken: 'fee-001',
      payerAddress: '0xExternalSender',
      assetTicker: 'ETH',
      quantity: '1',
    },
  };

  await blockchainEventHandler.handle(payload);
  await blockchainEventHandler.handle({ ...payload, status: TRANSACTION_STATE.CONFIRMED.id });

  console.log('Deposit flow completed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
