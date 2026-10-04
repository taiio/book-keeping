import { ConservationError } from '../common/errors';
import type { QuantityItem } from '../types';

export function sumByAsset(items: readonly QuantityItem[]): Map<string, bigint> {
  const totals = new Map<string, bigint>();

  for (const { assetTicker, quantity } of items) {
    totals.set(assetTicker, (totals.get(assetTicker) ?? 0n) + BigInt(quantity));
  }

  return totals;
}

export function assertConserved(senders: readonly QuantityItem[], recipients: readonly QuantityItem[], context: string): void {
  const sent = sumByAsset(senders);

  for (const [assetTicker, received] of sumByAsset(recipients)) {
    const total = sent.get(assetTicker) ?? 0n;

    if (total !== received) throw new ConservationError(context, assetTicker, total, received);
  }
}
