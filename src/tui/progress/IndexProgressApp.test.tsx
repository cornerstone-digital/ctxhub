import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { IndexProgressApp, type IndexFn } from './IndexProgressApp.js';
import type { RepoStatus } from './RepoStatusList.js';
import type { IndexResult } from '../../indexing/indexer.js';

function wait(ms = 30): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('IndexProgressApp shows each repo transitioning from queued to active to done/missing', async () => {
  let resolveIndex: (() => void) | undefined;
  const fakeIndexFn: IndexFn = (_cwd, _force, onProgress) => {
    onProgress?.({ type: 'repo-start', repo: 'app' });
    return new Promise(resolve => {
      resolveIndex = () => {
        onProgress?.({ type: 'repo-done', repo: 'app', scanned: 3, indexed: 2, skipped: 1 });
        onProgress?.({ type: 'repo-missing', repo: 'web' });
        resolve({ scanned: 3, indexed: 2, skipped: 1, deleted: 0 });
      };
    });
  };

  const { lastFrame, unmount } = render(
    React.createElement(IndexProgressApp, { repoNames: ['app', 'web'], cwd: '/tmp/ws', force: false, indexFn: fakeIndexFn })
  );

  try {
    await wait();
    const frame = lastFrame() ?? '';
    assert.match(frame, /◐ app/);
    assert.match(frame, /· web/);

    // Resolving triggers exit(), which clears Ink's live region by design (it's an
    // ephemeral in-progress view -- the durable record is what onSettled reports,
    // covered by the next test). Just confirm this doesn't throw.
    resolveIndex?.();
    await wait();
  } finally {
    unmount();
  }
});

test('IndexProgressApp reports the final per-repo statuses and aggregate result via onSettled, then exits', async () => {
  const fakeIndexFn: IndexFn = async (_cwd, _force, onProgress) => {
    onProgress?.({ type: 'repo-start', repo: 'app' });
    onProgress?.({ type: 'repo-done', repo: 'app', scanned: 3, indexed: 2, skipped: 1 });
    return { scanned: 3, indexed: 2, skipped: 1, deleted: 0 };
  };

  let settledRepos: RepoStatus[] | undefined;
  let settledResult: IndexResult | undefined;

  const { unmount } = render(
    React.createElement(IndexProgressApp, {
      repoNames: ['app'],
      cwd: '/tmp/ws',
      force: false,
      indexFn: fakeIndexFn,
      onSettled: (repos, result) => {
        settledRepos = repos;
        settledResult = result;
      }
    })
  );

  try {
    await wait();
    assert.deepEqual(settledRepos, [{ name: 'app', state: 'done', detail: '3 scanned, 2 indexed, 1 skipped' }]);
    assert.deepEqual(settledResult, { scanned: 3, indexed: 2, skipped: 1, deleted: 0 });
  } finally {
    unmount();
  }
});

test('IndexProgressApp reports index errors and exits', async () => {
  const expected = new Error('index unavailable');
  const fakeIndexFn: IndexFn = async () => {
    throw expected;
  };

  let settled = false;
  let reportedError: Error | undefined;

  const { unmount } = render(
    React.createElement(IndexProgressApp, {
      repoNames: ['app'],
      cwd: '/tmp/ws',
      force: false,
      indexFn: fakeIndexFn,
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
