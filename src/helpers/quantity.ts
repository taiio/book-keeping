/** Quantity là chuỗi số nguyên (đơn vị nhỏ nhất của asset) — luôn tính bằng BigInt để không mất chính xác. */
export function negateQuantity(quantity: string): string {
  return (-BigInt(quantity)).toString();
}
