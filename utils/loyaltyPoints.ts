const MAX_SQL_INT = 2_147_483_647n;

const decimalToCents = (value: string | number): bigint | null => {
  const text = String(value);
  const match = /^(\d{1,13})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  return BigInt(match[1]!) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
};

export const calculateLoyaltyPoints = (
  purchaseCents: number,
  earnAmount: string | number,
  earnPoints: number,
  minimumPurchase: string | number
): number | null => {
  if (!Number.isSafeInteger(purchaseCents) || purchaseCents < 0
    || !Number.isSafeInteger(earnPoints) || earnPoints < 1 || earnPoints > Number(MAX_SQL_INT)) {
    return null;
  }

  const earnAmountCents = decimalToCents(earnAmount);
  const minimumPurchaseCents = decimalToCents(minimumPurchase);
  if (earnAmountCents === null || earnAmountCents <= 0n
    || minimumPurchaseCents === null) return null;

  const purchase = BigInt(purchaseCents);
  if (purchase < minimumPurchaseCents) return 0;

  const points = (purchase / earnAmountCents) * BigInt(earnPoints);
  return points <= MAX_SQL_INT ? Number(points) : null;
};
