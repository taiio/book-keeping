import { BOOK_POSTING_PURPOSE, TRANSACTION_STATE, TRANSACTION_TYPE } from '../../constants';
import { custodyBook } from '../../helpers';
import { applyPlanToHoldings, planTransition } from '../../ledger/transitionPlanner';
import type { Holding, LedgerLeg, LegItem, PlannedPosting } from '../../types';

const S = TRANSACTION_STATE;

export const USER: LegItem = { clientId: 1, accountId: 1, assetTypeId: 1, walletTypeId: 1, assetId: 1, assetTicker: 'USDT' };
export const FEE_PAYER: LegItem = { clientId: 1, accountId: 2, assetTypeId: 2, walletTypeId: 1, assetId: 2, assetTicker: 'ETH' };

export const amountLeg = (amount: string): LedgerLeg => ({ item: USER, amount, purpose: BOOK_POSTING_PURPOSE.AMOUNT });
export const feeLeg = (amount: string): LedgerLeg => ({ item: FEE_PAYER, amount, purpose: BOOK_POSTING_PURPOSE.FEE });

export const withdrawHoldings = (stateId: number, amount = 1000n, fee = 10n): Holding[] => [
  { ref: custodyBook(stateId), item: USER, purpose: BOOK_POSTING_PURPOSE.AMOUNT, amount },
  { ref: custodyBook(stateId), item: FEE_PAYER, purpose: BOOK_POSTING_PURPOSE.FEE, amount: fee },
];

export function playWithdraw(through: readonly number[], amount = '1000', fee = '10') {
  let holdings: Holding[] = [];
  let currentStateId: number | null = null;
  const plans: PlannedPosting[][] = [];

  for (const targetStateId of through) {
    const planned = planTransition({
      journalTransactionId: '1',
      transactionTypeId: TRANSACTION_TYPE.WITHDRAW,
      currentStateId,
      targetStateId,
      legs: [amountLeg(amount), feeLeg(fee)],
      holdings,
    });

    plans.push(planned);
    holdings = applyPlanToHoldings(holdings, planned);
    currentStateId = targetStateId;
  }

  return { plans, holdings, currentStateId };
}

export const HAPPY_PATH = [S.AUTHORIZING.id, S.AUTHORIZED.id, S.SENT.id, S.CONFIRMING.id] as const;

export function netByBook(plans: PlannedPosting[][]): Map<string, bigint> {
  const net = new Map<string, bigint>();
  const add = (key: string, value: bigint) => net.set(key, (net.get(key) ?? 0n) + value);

  for (const planned of plans.flat()) {
    const label = (ref: PlannedPosting['from']) => `${planned.item.accountId}/${planned.item.assetTicker}/${ref.transactionStateId ?? 'external'}`;

    add(label(planned.from), -BigInt(planned.amount));
    add(label(planned.to), BigInt(planned.amount));
  }

  return new Map([...net].filter(([, value]) => value !== 0n));
}
