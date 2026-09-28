import type { DepositPhase, LedgerPhase } from '../interfaces';

/** Khoá idempotency của 1 movement: ổn định theo (journal, vế, giai đoạn) nên gọi lại là no-op. */
export function movementKey(uuidToken: string, legKey: string, phase: LedgerPhase): string {
  return `${uuidToken}:${legKey}:${phase}`;
}

/** Khoá movement của bút toán DEPOSIT theo bước: CONFIRMING (external -> confirming), CONFIRMED (confirming -> available), FAILED (confirming -> external). */
export function depositMovementKey(uuidToken: string, phase: DepositPhase): string {
  return `${uuidToken}:DEP:${phase}`;
}

/**
 * Khoá idempotency ổn định cho 1 deposit event cụ thể. Deposit tới từ blockchain chứ
 * không phải request nội bộ nên không có idempotencyToken từ caller.
 */
export function depositIdempotencyToken(transactionHash: string, address: string, assetTicker: string): string {
  return `deposit:${transactionHash}:${address}:${assetTicker}`;
}

/** Khoá idempotency của 2 vế (A = trừ, B = cộng) trong 1 bút toán đúp. */
export function postingTokens(movement: string): { debit: string; credit: string } {
  return { debit: `${movement}:A`, credit: `${movement}:B` };
}
