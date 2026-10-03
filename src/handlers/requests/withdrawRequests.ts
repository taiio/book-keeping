import { BOOK_POSTING_PURPOSE } from '../../constants';
import { isFeePaidBy, toLegItem } from '../../helpers';
import type { JournalTransaction } from '../../models';
import type { LedgerLeg, TransitionRequest, Withdraw } from '../../types';

export function buildWithdrawRequests(withdraw: Withdraw, senders: JournalTransaction[]): TransitionRequest[] {
  const requests = senderRequests(withdraw, senders);
  const fee = feeRequest(withdraw, senders);

  if (fee) requests.push(fee);

  return requests;
}

function findByToken(journalTransactions: JournalTransaction[], idempotencyToken: string, label: string): JournalTransaction {
  const found = journalTransactions.find((jt) => jt.idempotencyToken === idempotencyToken);

  if (!found) throw new Error(`${label} journal transaction not found: ${idempotencyToken}`);

  return found;
}

function senderRequests(withdraw: Withdraw, senders: JournalTransaction[]): TransitionRequest[] {
  return withdraw.sender.map((sender) => {
    const legs: LedgerLeg[] = [{ item: toLegItem(sender.account!, sender.assetTicker), amount: sender.quantity, purpose: BOOK_POSTING_PURPOSE.AMOUNT }];

    if (isFeePaidBy(withdraw.fee, sender)) {
      legs.push({ item: toLegItem(withdraw.fee.account, withdraw.fee.assetTicker), amount: withdraw.fee.quantity, purpose: BOOK_POSTING_PURPOSE.FEE });
    }

    return { journalTransaction: findByToken(senders, sender.idempotencyToken, 'Sender'), targetStateId: withdraw.transactionStateId, legs };
  });
}

function feeRequest(withdraw: Withdraw, senders: JournalTransaction[]): TransitionRequest | null {
  const { fee } = withdraw;

  if (withdraw.sender.some((sender) => isFeePaidBy(fee, sender))) return null;

  return {
    journalTransaction: findByToken(senders, fee.idempotencyToken, 'Fee'),
    targetStateId: withdraw.transactionStateId,
    legs: [{ item: toLegItem(fee.account, fee.assetTicker), amount: fee.quantity, purpose: BOOK_POSTING_PURPOSE.FEE }],
  };
}
