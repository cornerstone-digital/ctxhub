import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { estimateBaselineTokensFromFileSizes, readUsageStats, recordToolUsage, summarizeUsageStats } from './usageStats.js';

async function withStatsPath(run: (statsPath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-stats-'));
  try {
    await run(path.join(dir, 'stats.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('estimateBaselineTokensFromFileSizes dedupes paths and skips unreadable ones', () => {
  const sizes: Record<string, number> = { '/a.ts': 400, '/b.ts': 800 };
  const total = estimateBaselineTokensFromFileSizes(
    ['/a.ts', '/a.ts', '/b.ts', undefined, '/missing.ts'],
    path => {
      if (!(path in sizes)) throw new Error('ENOENT');
      return { size: sizes[path] };
    }
  );
  assert.equal(total, 100 + 200);
});

test('recordToolUsage accumulates calls/tokens across multiple invocations', () => {
  return withStatsPath(async statsPath => {
    await recordToolUsage(statsPath, 'search', 50, 400);
    await recordToolUsage(statsPath, 'search', 30, 200);
    await recordToolUsage(statsPath, 'open_chunk', 10, 100);

    const stats = await readUsageStats(statsPath);
    assert.equal(stats?.tools.search.calls, 2);
    assert.equal(stats?.tools.search.tokensReturned, 80);
    assert.equal(stats?.tools.search.tokensBaseline, 600);
    assert.equal(stats?.tools.open_chunk.calls, 1);
  });
});

test('readUsageStats returns undefined when no stats file exists yet', () => {
  return withStatsPath(async statsPath => {
    const stats = await readUsageStats(statsPath);
    assert.equal(stats, undefined);
  });
});

test('summarizeUsageStats computes totals, savings, and per-tool breakdown sorted by tokens saved', () => {
  const summary = summarizeUsageStats({
    since: '2026-01-01T00:00:00.000Z',
    lastUpdated: '2026-01-02T00:00:00.000Z',
    tools: {
      search: { calls: 3, tokensReturned: 100, tokensBaseline: 1000 },
      open_chunk: { calls: 1, tokensReturned: 50, tokensBaseline: 150 }
    }
  });

  assert.equal(summary.totalCalls, 4);
  assert.equal(summary.tokensReturned, 150);
  assert.equal(summary.tokensBaseline, 1150);
  assert.equal(summary.tokensSaved, 1000);
  assert.equal(summary.tools[0].tool, 'search');
  assert.equal(summary.tools[0].tokensSaved, 900);
  assert.equal(summary.tools[1].tool, 'open_chunk');
});

test('summarizeUsageStats handles no recorded usage without dividing by zero', () => {
  const summary = summarizeUsageStats(undefined);
  assert.equal(summary.totalCalls, 0);
  assert.equal(summary.savingsPercent, 0);
  assert.deepEqual(summary.tools, []);
});
