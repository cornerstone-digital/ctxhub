import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens } from './tokenEstimate.js';

test('estimateTokens rounds up chars/4', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('ab'), 1);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateTokens('a'.repeat(400)), 100);
});
