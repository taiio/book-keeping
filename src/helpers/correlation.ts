import type { BlockchainMessagePayload, SystemTransaction } from '../types';
import type { JournalTransaction } from '../models';

export function parseSourceContent(journalTransaction: JournalTransaction): SystemTransaction | null {
  if (!journalTransaction.sourceContent) {
    return null;
  }

  try {
    return JSON.parse(journalTransaction.sourceContent) as SystemTransaction;
  } catch {
    return null;
  }
}

function extractDeclaredAddresses(transaction: SystemTransaction): string[] {
  const senders = Array.isArray(transaction.sender) ? transaction.sender : [transaction.sender];

  return senders.map((item) => item.address).filter((address): address is string => !!address);
}

export function matchesSender(original: SystemTransaction | null, payload: BlockchainMessagePayload): boolean {
  if (!original) {
    return true;
  }

  const declaredAddresses = extractDeclaredAddresses(original);

  if (declaredAddresses.length === 0) {
    return true;
  }

  const incomingAddresses = new Set(payload.senders.map((sender) => sender.address));

  return declaredAddresses.some((address) => incomingAddresses.has(address));
}
