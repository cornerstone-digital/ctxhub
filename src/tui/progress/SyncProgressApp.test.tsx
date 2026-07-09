import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { SyncProgressApp, type PullFn } from './SyncProgressApp.js';
import type { IndexFn } from './IndexProgressApp.js';
import type { RepoStatus } from './RepoStatusList.js';
import type { IndexResult } from '../../indexing/indexer.js';

function wait(ms = 30): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const REPOS = [{ name: 'app', path: './app' }, { name: 'web', path: './web' }];

test('SyncProgressApp pulls each repo then indexes, reporting both phases via onSettled', async () => {
  const pulled: string[] = [];
  const pullFn: PullFn = async repoPath => {
    pulled.push(repoPath);
    if (repoPath === './web') throw new Error('network error');
  };
  const indexFn: IndexFn = async (_cwd, _force, onProgress) => {
    onProgress?.({ type: 'repo-start', repo: 'app' });
    onProgress?.({ type: 'repo-done', repo: 'app', scanned: 2, indexed: 1, skipped: 1 });
    onProgress?.({ type: 'repo-start', repo: 'web' });
    onProgress?.({ type: 'repo-done', repo: 'web', scanned: 1, indexed: 1, skipped: 0 });
    return { scanned: 3, indexed: 2, skipped: 1, deleted: 0 };
  };

  let settledPull: RepoStatus[] | undefined;
  let settledIndex: RepoStatus[] | undefined;
  let settledResult: IndexResult | undefined;

  const { unmount } = render(
    React.createElement(SyncProgressApp, {
      repos: REPOS,
      cwd: '/tmp/ws',
      noPull: false,
      pullFn,
      indexFn,
      onSettled: (pullResults, indexResults, result) => {
        settledPull = pullResults;
        settledIndex = indexResults;
        settledResult = result;
      }
    })
  );

  try {
    await wait(50);
    assert.deepEqual(pulled, ['./app', './web']);
    assert.deepEqual(settledPull, [
      { name: 'app', state: 'done', detail: 'pulled' },
      { name: 'web', state: 'error', detail: 'network error' }
    ]);
    assert.deepEqual(settledIndex, [
      { name: 'app', state: 'done', detail: '2 scanned, 1 indexed, 1 skipped' },
      { name: 'web', state: 'done', detail: '1 scanned, 1 indexed, 0 skipped' }
    ]);
    assert.deepEqual(settledResult, { scanned: 3, indexed: 2, skipped: 1, deleted: 0 });
  } finally {
    unmount();
  }
});

test('SyncProgressApp --no-pull skips the pull phase entirely', async () => {
  let pullCalled = false;
  const pullFn: PullFn = async () => {
    pullCalled = true;
  };
  const indexFn: IndexFn = async () => ({ scanned: 0, indexed: 0, skipped: 0, deleted: 0 });

  let settledPull: RepoStatus[] | undefined;

  const { lastFrame, unmount } = render(
    React.createElement(SyncProgressApp, {
      repos: REPOS,
      cwd: '/tmp/ws',
      noPull: true,
      pullFn,
      indexFn,
      onSettled: pullResults => {
        settledPull = pullResults;
      }
    })
  );

  try {
    await wait(30);
    assert.equal(pullCalled, false);
    assert.doesNotMatch(lastFrame() ?? '', /Pulling repositories/);
    assert.deepEqual(settledPull, [{ name: 'app', state: 'queued' }, { name: 'web', state: 'queued' }]);
  } finally {
    unmount();
  }
});

test('SyncProgressApp reports index errors and exits', async () => {
  const expected = new Error('index failed');
  const indexFn: IndexFn = async () => {
    throw expected;
  };

  let settled = false;
  let reportedError: Error | undefined;

  const { unmount } = render(
    React.createElement(SyncProgressApp, {
      repos: REPOS,
      cwd: '/tmp/ws',
      noPull: true,
      indexFn,
      onSettled: () => {
        settled = true;
      },
      onError: error => {
        reportedError = error;
      }
    })
  );

  try {
    await wait();
    assert.equal(settled, false);
    assert.equal(reportedError, expected);
  } finally {
    unmount();
  }
});
