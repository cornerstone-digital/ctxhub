import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrencyLimit } from './concurrency.js';

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('mapWithConcurrencyLimit returns results in input order regardless of completion order', async () => {
  const items = [30, 10, 20, 5];
  const results = await mapWithConcurrencyLimit(items, 4, async ms => {
    await delay(ms);
    return ms;
  });
  assert.deepEqual(results, items);
});

test('mapWithConcurrencyLimit never runs more than `limit` tasks at once', async () => {
  let active = 0;
  let maxActive = 0;
  const items = Array.from({ length: 12 }, (_, i) => i);

  await mapWithConcurrencyLimit(items, 3, async i => {
    active++;
    maxActive = Math.max(maxActive, active);
    await delay(5);
    active--;
    return i;
  });

  assert.ok(maxActive <= 3, `expected at most 3 concurrent tasks, saw ${maxActive}`);
  assert.equal(maxActive, 3, 'expected the limit to actually be reached with 12 items and a limit of 3');
});

test('mapWithConcurrencyLimit runs genuinely in parallel (wall-clock proof, not just a claim)', async () => {
  const items = Array.from({ length: 8 }, () => 20);
  const started = Date.now();
  await mapWithConcurrencyLimit(items, 8, async ms => {
    await delay(ms);
  });
  const elapsed = Date.now() - started;
  // 8 items * 20ms would be ~160ms run sequentially; concurrency=8 should finish close to one
  // 20ms slot. Generous upper bound to avoid CI flakiness while still proving it's not sequential.
  assert.ok(elapsed < 100, `expected parallel execution well under 100ms, took ${elapsed}ms`);
});

test('mapWithConcurrencyLimit handles an empty input array', async () => {
  const results = await mapWithConcurrencyLimit([], 4, async () => 1);
  assert.deepEqual(results, []);
});

test('mapWithConcurrencyLimit clamps a limit larger than the item count without error', async () => {
  const results = await mapWithConcurrencyLimit([1, 2], 100, async n => n * 2);
  assert.deepEqual(results, [2, 4]);
});

test('mapWithConcurrencyLimit propagates a task rejection', async () => {
  await assert.rejects(
    () => mapWithConcurrencyLimit([1, 2, 3], 2, async n => {
      if (n === 2) throw new Error('boom');
      return n;
    }),
    /boom/
  );
});
