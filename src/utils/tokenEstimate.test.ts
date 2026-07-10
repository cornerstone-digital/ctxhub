import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateTokens, trimToTokenBudget } from './tokenEstimate.js';

test('estimateTokens rounds up chars/4', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('ab'), 1);
  assert.equal(estimateTokens('abcd'), 1);
  assert.equal(estimateTokens('abcde'), 2);
  assert.equal(estimateTokens('a'.repeat(400)), 100);
});

test('trimToTokenBudget keeps items greedily until the budget would be exceeded', () => {
  const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const { kept, droppedIds } = trimToTokenBudget(items, 25, () => 10);
  assert.deepEqual(kept.map(i => i.id), ['a', 'b']);
  assert.deepEqual(droppedIds, ['c', 'd']);
});

test('trimToTokenBudget always keeps the first item even if it alone exceeds the budget', () => {
  const items = [{ id: 'huge' }, { id: 'small' }];
  const { kept, droppedIds } = trimToTokenBudget(items, 5, item => (item.id === 'huge' ? 1000 : 1));
  assert.deepEqual(kept.map(i => i.id), ['huge']);
  assert.deepEqual(droppedIds, ['small']);
});

test('trimToTokenBudget drops nothing when everything fits', () => {
  const items = [{ id: 'a' }, { id: 'b' }];
  const { kept, droppedIds } = trimToTokenBudget(items, 1000, () => 10);
  assert.deepEqual(kept, items);
  assert.deepEqual(droppedIds, []);
});
