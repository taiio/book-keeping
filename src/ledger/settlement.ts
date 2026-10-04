import { ConservationError } from '../common/errors';
import { BOOK_POSTING_PURPOSE, BOOK_PURPOSE, TRANSACTION_STATE } from '../constants';
import { custodyBook, sameBookRef } from '../helpers';
import type { Holding, QuantityItem } from '../types';

const isAmount = (holding: Holding): boolean => holding.purpose === BOOK_POSTING_PURPOSE.AMOUNT && holding.amount > 0n;

const hasLeftSenders = (holding: Holding): boolean => isAmount(holding) && !sameBookRef(holding.ref, custodyBook(TRANSACTION_STATE.CONFIRMED.id));

const isCredited = (holding: Holding): boolean => isAmount(holding) && holding.ref.bookPurposeId === BOOK_PURPOSE.CUSTODY_ASSET_ACCOUNT.id;

function totalsByAssetType(holdings: readonly Holding[]): Map<number, bigint> {
  const totals = new Map<number, bigint>();

  for (const { item, amount } of holdings) {
    totals.set(item.assetTypeId, (totals.get(item.assetTypeId) ?? 0n) + amount);
  }

  return totals;
}

function assetTypeByTicker(holdings: readonly Holding[], context: string): Map<string, number> {
  const types = new Map<string, number>();

  for (const { item } of holdings) {
    const known = types.get(item.assetTicker);

    if (known !== undefined && known !== item.assetTypeId) throw new ConservationError(`${context}, ambiguous asset ticker`, item.assetTicker, 0n, 0n);

    types.set(item.assetTicker, item.assetTypeId);
  }

  return types;
}

export function assertSettlementBalanced(
  senderHoldings: readonly Holding[],
  recipientHoldings: readonly Holding[],
  externalRecipients: readonly QuantityItem[],
  context: string,
): void {
  const sent = totalsByAssetType(senderHoldings.filter(hasLeftSenders));
  const credited = totalsByAssetType(recipientHoldings.filter(isCredited));
  const typeByTicker = assetTypeByTicker([...senderHoldings, ...recipientHoldings], context);
  const tickerByType = new Map([...typeByTicker].map(([ticker, assetTypeId]) => [assetTypeId, ticker]));
  const external = new Map<number, bigint>();

  for (const { assetTicker, quantity } of externalRecipients) {
    const assetTypeId = typeByTicker.get(assetTicker);

    if (assetTypeId === undefined) throw new ConservationError(context, assetTicker, 0n, BigInt(quantity));

    external.set(assetTypeId, (external.get(assetTypeId) ?? 0n) + BigInt(quantity));
  }

  for (const assetTypeId of new Set([...credited.keys(), ...external.keys()])) {
    const sentTotal = sent.get(assetTypeId) ?? 0n;
    const receivedTotal = (credited.get(assetTypeId) ?? 0n) + (external.get(assetTypeId) ?? 0n);

    if (sentTotal !== receivedTotal) throw new ConservationError(context, tickerByType.get(assetTypeId) ?? String(assetTypeId), sentTotal, receivedTotal);
  }
}
