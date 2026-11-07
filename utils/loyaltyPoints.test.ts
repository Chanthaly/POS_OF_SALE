import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateLoyaltyPoints } from './loyaltyPoints.js';

test('awards whole loyalty-point increments based on net purchase amount', () => {
  assert.equal(calculateLoyaltyPoints(25_000, '100.00', 1, '0.00'), 2);
  assert.equal(calculateLoyaltyPoints(25_000, '100.00', 3, '0.00'), 6);
});

test('awards no points below the minimum purchase or below one earn increment', () => {
  assert.equal(calculateLoyaltyPoints(9_999, '100.00', 1, '100.00'), 0);
  assert.equal(calculateLoyaltyPoints(9_999, '100.00', 1, '0.00'), 0);
});

test('uses exact decimal cents when calculating loyalty points', () => {
  assert.equal(calculateLoyaltyPoints(1_000, '0.25', 2, '10.00'), 80);
});

test('rejects invalid loyalty settings and point totals outside the database range', () => {
  assert.equal(calculateLoyaltyPoints(10_000, '0.00', 1, '0.00'), null);
  assert.equal(calculateLoyaltyPoints(10_000, '100.00', 0, '0.00'), null);
  assert.equal(calculateLoyaltyPoints(10_000, '0.01', 2_147_483_647, '0.00'), null);
});
