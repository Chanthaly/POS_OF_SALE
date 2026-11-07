import assert from 'node:assert/strict';
import test from 'node:test';
import { positiveInt } from './numberHelper.js';

test('positiveInt returns positive integer numbers and numeric strings', () => {
  assert.equal(positiveInt(1), 1);
  assert.equal(positiveInt(42), 42);
  assert.equal(positiveInt('7'), 7);
  assert.equal(positiveInt(' 12 '), 12);
});

test('positiveInt rejects zero, negative, fractional, and non-finite values', () => {
  assert.equal(positiveInt(0), null);
  assert.equal(positiveInt(-1), null);
  assert.equal(positiveInt(1.5), null);
  assert.equal(positiveInt(Number.NaN), null);
  assert.equal(positiveInt(Number.POSITIVE_INFINITY), null);
});

test('positiveInt rejects empty and non-numeric strings', () => {
  assert.equal(positiveInt(''), null);
  assert.equal(positiveInt('   '), null);
  assert.equal(positiveInt('abc'), null);
});

test('positiveInt rejects values that are not numbers or strings', () => {
  assert.equal(positiveInt(null), null);
  assert.equal(positiveInt(undefined), null);
  assert.equal(positiveInt(true), null);
  assert.equal(positiveInt(Symbol('1')), null);
  assert.equal(positiveInt([]), null);
  assert.equal(positiveInt([1]), null);
  assert.equal(positiveInt({ valueOf: () => 1 }), null);
});
