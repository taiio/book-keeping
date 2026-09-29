export function negateQuantity(quantity: string): string {
  return (-BigInt(quantity)).toString();
}
