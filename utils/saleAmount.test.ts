import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateDiscountCents } from './saleAmount.js';

test('discount remainder is not assigned to a zero-value line', () => {
  assert.deepEqual(allocateDiscountCents([0, 1, 1], 1, 2), [0, 1, 0]);
});

test('discount allocation preserves the total and never exceeds line amounts', () => {
  const lineAmounts = [3, 7, 0, 11];
  const discounts = allocateDiscountCents(lineAmounts, 8, 21);

  assert.equal(discounts.reduce((sum, amount) => sum + amount, 0), 8);
  assert.ok(discounts.every((amount, index) => amount <= (lineAmounts[index] ?? 0)));
});

test('a full discount is allocated only to positive-value lines', () => {
  assert.deepEqual(allocateDiscountCents([0, 25, 75], 100, 100), [0, 25, 75]);
});

test('discount allocation rejects inconsistent totals and invalid amounts', () => {
  assert.throws(() => allocateDiscountCents([1, 1], 1, 3), RangeError);
  assert.throws(() => allocateDiscountCents([1, -1], 0, 0), RangeError);
  assert.throws(() => allocateDiscountCents([1], 2, 1), RangeError);
});
