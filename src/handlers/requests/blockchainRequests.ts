import { NotFoundError } from '../../common/errors';
import { BOOK_POSTING_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../../constants';
import { toLegItem } from '../../helpers';
import type { JournalTransaction } from '../../models';
import type { BlockchainMessagePayload, LedgerLeg, TransitionRequest } from '../../types';
import { buildClosingRequests } from './closingRequests';

/** Requests for every journal transaction a blockchain event touches (senders, fee payer, internal recipients). */
export function buildBlockchainRequests(journalTransactions: JournalTransaction[], payload: BlockchainMessagePayload): TransitionRequest[] {
  if (payload.status === TRANSACTION_STATE.FAILED.id) {
    return buildClosingRequests(journalTransactions, payload.status, payload.networkFee.quantity);
  }

  const withdraws = journalTransactions.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.WITHDRAW);
  const deposits = journalTransactions.filter((jt) => jt.transactionTypeId === TRANSACTION_TYPE.DEPOSIT);

  return [
    ...withdraws.filter((jt) => !isSeparateFeeJournal(jt, payload)).map((jt) => request(jt, payload, senderLegs(jt, payload))),
    ...withdraws.filter((jt) => isSeparateFeeJournal(jt, payload)).map((jt) => request(jt, payload, feeLegs(jt, payload))),
    ...deposits.map((jt) => request(jt, payload, recipientLegs(jt, payload))),
  ];
}

const request = (journalTransaction: JournalTransaction, payload: BlockchainMessagePayload, legs: LedgerLeg[]): TransitionRequest => ({
  journalTransaction,
  targetStateId: payload.status,
  legs,
});

function senderLegs(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): LedgerLeg[] {
  const sender = payload.senders.find((item) => item.idempotencyToken === journalTransaction.idempotencyToken);

  if (!sender?.account) throw new NotFoundError('Blockchain sender for JournalTransaction', journalTransaction.id);

  const legs: LedgerLeg[] = [{ item: toLegItem(sender.account, sender.assetTicker), amount: sender.quantity, purpose: BOOK_POSTING_PURPOSE.AMOUNT }];
  const fee = payload.networkFee;

  if (fee.account && fee.idempotencyToken === sender.idempotencyToken && fee.account.accountId === sender.account.accountId) {
    legs.push({ item: toLegItem(fee.account, fee.assetTicker), amount: fee.quantity, purpose: BOOK_POSTING_PURPOSE.FEE });
  }

  return legs;
}

function feeLegs(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): LedgerLeg[] {
  const fee = payload.networkFee;

  if (!fee.account || fee.idempotencyToken !== journalTransaction.idempotencyToken) {
    throw new NotFoundError('Blockchain fee for JournalTransaction', journalTransaction.id);
  }

  return [{ item: toLegItem(fee.account, fee.assetTicker), amount: fee.quantity, purpose: BOOK_POSTING_PURPOSE.FEE }];
}

function recipientLegs(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): LedgerLeg[] {
  const recipient = payload.recipients.find((item) => item.idempotencyToken === journalTransaction.idempotencyToken);

  if (!recipient?.account) throw new NotFoundError('Blockchain recipient for JournalTransaction', journalTransaction.id);

  return [{ item: toLegItem(recipient.account, recipient.assetTicker), amount: recipient.quantity, purpose: BOOK_POSTING_PURPOSE.AMOUNT }];
}

/** The fee payer owns its own journal transaction when it is not one of the senders. */
function isSeparateFeeJournal(journalTransaction: JournalTransaction, payload: BlockchainMessagePayload): boolean {
  const fee = payload.networkFee;

  return Boolean(
    fee.account &&
      journalTransaction.transactionTypeId === TRANSACTION_TYPE.WITHDRAW &&
      journalTransaction.idempotencyToken === fee.idempotencyToken &&
      journalTransaction.fromAccountId === fee.account.accountId &&
      !payload.senders.some((sender) => sender.idempotencyToken === journalTransaction.idempotencyToken && sender.account?.accountId === fee.account!.accountId),
  );
}
