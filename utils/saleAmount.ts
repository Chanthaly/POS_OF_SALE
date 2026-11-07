const floorRatio = (amount: number, numerator: number, denominator: number): number =>
  Number((BigInt(amount) * BigInt(numerator)) / BigInt(denominator));

// แบ่งส่วนลดรวมเป็นสตางค์ตามสัดส่วนยอดแต่ละบรรทัด และกระจายเศษโดยไม่เกินยอดบรรทัด
export const allocateDiscountCents = (
  lineAmounts: number[],
  discountCents: number,
  subtotalCents: number
): number[] => {
  if (!Number.isSafeInteger(subtotalCents) || subtotalCents <= 0
    || !Number.isSafeInteger(discountCents) || discountCents < 0
    || discountCents > subtotalCents
    || lineAmounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0)
    || lineAmounts.reduce((sum, amount) => sum + amount, 0) !== subtotalCents) {
    throw new RangeError('Sale amounts are invalid for discount allocation');
  }

  const discounts = lineAmounts.map((amount) =>
    floorRatio(discountCents, amount, subtotalCents)
  );
  let remainder = discountCents - discounts.reduce((sum, amount) => sum + amount, 0);

  for (let index = 0; remainder > 0 && index < lineAmounts.length; index += 1) {
    if ((lineAmounts[index] ?? 0) > 0) {
      discounts[index] = (discounts[index] ?? 0) + 1;
      remainder -= 1;
    }
  }

  if (remainder !== 0) throw new RangeError('Discount cannot be allocated to sale items');
  return discounts;
};
