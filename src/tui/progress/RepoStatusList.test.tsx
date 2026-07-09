import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { RepoStatusList, summarizeRepoStatuses, type RepoStatus } from './RepoStatusList.js';

test('RepoStatusList renders an icon and optional detail per repo state', () => {
  const repos: RepoStatus[] = [
    { name: 'queued-repo', state: 'queued' },
    { name: 'active-repo', state: 'active' },
    { name: 'done-repo', state: 'done', detail: '42 files' },
    { name: 'missing-repo', state: 'missing', detail: 'path missing' },
    { name: 'error-repo', state: 'error', detail: 'boom' }
  ];

  const { lastFrame, unmount } = render(React.createElement(RepoStatusList, { repos }));
  try {
    const frame = lastFrame() ?? '';
    assert.match(frame, /· queued-repo/);
    assert.match(frame, /◐ active-repo/);
    assert.match(frame, /✓ done-repo — 42 files/);
    assert.match(frame, /! missing-repo — path missing/);
    assert.match(frame, /✗ error-repo — boom/);
  } finally {
    unmount();
  }
});

test('summarizeRepoStatuses reports compact state counts', () => {
  const repos: RepoStatus[] = [
    { name: 'queued-repo', state: 'queued' },
    { name: 'active-repo', state: 'active' },
    { name: 'done-repo', state: 'done' },
    { name: 'missing-repo', state: 'missing' },
    { name: 'error-repo', state: 'error' }
  ];

  assert.equal(summarizeRepoStatuses(repos), '1 active · 1 done · 1 queued · 1 missing · 1 error');
  assert.equal(summarizeRepoStatuses([]), 'no repositories');
});
