import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { WatchProgressApp } from './WatchProgressApp.js';
import type { IndexFn } from './IndexProgressApp.js';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('WatchProgressApp runs an indexing cycle immediately, then again on each interval tick', async () => {
  let callCount = 0;
  const indexFn: IndexFn = async (_cwd, _force, onProgress) => {
    callCount++;
    onProgress?.({ type: 'repo-start', repo: 'app' });
    onProgress?.({ type: 'repo-done', repo: 'app', scanned: 1, indexed: callCount, skipped: 0 });
    return { scanned: 1, indexed: callCount, skipped: 0, deleted: 0 };
  };

  const { lastFrame, unmount } = render(
    React.createElement(WatchProgressApp, { repoNames: ['app'], cwd: '/tmp/ws', intervalMs: 300, indexFn })
  );

  try {
    await wait(60);
    assert.equal(callCount, 1, 'runs one cycle immediately on mount');
    assert.match(lastFrame() ?? '', /Cycles: 1/);

    await wait(300);
    assert.ok(callCount >= 2, 'runs another cycle after the interval elapses');

    const frame = lastFrame() ?? '';
    assert.match(frame, /Recent activity/);
    assert.match(frame, /indexed=\d+ deleted=0 skipped=0/);
  } finally {
    unmount();
  }
});

test('WatchProgressApp stops running cycles once unmounted (Ctrl+C equivalent)', async () => {
  let callCount = 0;
  const indexFn: IndexFn = async () => {
    callCount++;
    return { scanned: 0, indexed: 0, skipped: 0, deleted: 0 };
  };

  const { unmount } = render(
    React.createElement(WatchProgressApp, { repoNames: ['app'], cwd: '/tmp/ws', intervalMs: 20, indexFn })
  );

  await wait(15);
  const countAtUnmount = callCount;
  unmount();
  await wait(60);

  assert.equal(callCount, countAtUnmount, 'no further cycles run after unmount clears the interval');
});

test('WatchProgressApp records a cycle error in the activity log instead of crashing', async () => {
  const indexFn: IndexFn = async () => {
    throw new Error('index boom');
  };

  const { lastFrame, unmount } = render(
    React.createElement(WatchProgressApp, { repoNames: ['app'], cwd: '/tmp/ws', intervalMs: 1000, indexFn })
  );

  try {
    await wait(15);
    assert.match(lastFrame() ?? '', /error: index boom/);
  } finally {
    unmount();
  }
});
