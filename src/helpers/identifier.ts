export function compareIdentifiers(a: string, b: string): number {
  const left = BigInt(a);
  const right = BigInt(b);

  return left < right ? -1 : left > right ? 1 : 0;
}

export function nextSequence(current: string): string {
  return (BigInt(current) + 1n).toString();
}
