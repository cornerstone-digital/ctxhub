import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokeniseQuery, searchDecisions } from './decisionSearch.js';

test('tokeniseQuery splits on spaces and punctuation', () => {
  const tokens = tokeniseQuery('why did we choose PostgreSQL?');
  // stop words: why, did (not 'we' — not in the stop words list)
  assert.ok(!tokens.includes('why'));
  assert.ok(!tokens.includes('did'));
  assert.ok(tokens.includes('we')); // 'we' is NOT a stop word per spec
  assert.ok(tokens.includes('choose'));
  assert.ok(tokens.includes('postgresql'));
});

test('tokeniseQuery strips stop words', () => {
  const tokens = tokeniseQuery('what is the database');
  // 'what', 'is', 'the' are all stop words
  assert.ok(!tokens.includes('what'));
  assert.ok(!tokens.includes('is'));
  assert.ok(!tokens.includes('the'));
  assert.ok(tokens.includes('database'));
});

test('tokeniseQuery returns empty array for all-stop-words query', () => {
  const tokens = tokeniseQuery('what is the');
  assert.deepEqual(tokens, []);
});

test('tokeniseQuery is case-insensitive', () => {
  const tokens = tokeniseQuery('PostgreSQL DATABASE');
  assert.ok(tokens.includes('postgresql'));
  assert.ok(tokens.includes('database'));
});

test('searchDecisions returns empty array for empty query', async () => {
  const results = await searchDecisions('');
  assert.deepEqual(results, []);
});

test('searchDecisions returns empty array for whitespace query', async () => {
  const results = await searchDecisions('   ');
  assert.deepEqual(results, []);
});

test('searchDecisions returns empty array for stop-words-only query', async () => {
  const results = await searchDecisions('what is the');
  assert.deepEqual(results, []);
});
