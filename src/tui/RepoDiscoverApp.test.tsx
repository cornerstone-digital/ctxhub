import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { RepoDiscoverApp } from './RepoDiscoverApp.js';
import type { DiscoveredRepo } from '../commands/repo.js';

const ENTER = '\r';
const SPACE = ' ';
const ESCAPE = '\u001B';

function wait(ms = 30): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const REPOS: DiscoveredRepo[] = [
  { name: 'app', path: 'repos/app', state: 'new' },
  { name: 'shared', path: 'repos/shared', state: 'configured' }
];

test('RepoDiscoverApp previews discovered repos and returns selected new repos', async () => {
  let selected: DiscoveredRepo[] | undefined;
  const { stdin, lastFrame, unmount } = render(
    React.createElement(RepoDiscoverApp, {
      root: 'repos',
      repos: REPOS,
      onDone: value => {
        selected = value;
      }
    })
  );

  try {
    await wait();
    const frame = lastFrame() ?? '';
    assert.match(frame, /ctxhub repo discover/);
    assert.match(frame, /1 new/);
    assert.match(frame, /Preview/);
    assert.match(frame, /\[x\] app/);
    assert.match(frame, /✓ shared/);

    stdin.write(ENTER);
    await wait();

    assert.deepEqual(selected, [REPOS[0]]);
  } finally {
    unmount();
  }
});

test('RepoDiscoverApp lets users deselect all repos or cancel', async () => {
  let selected: DiscoveredRepo[] | undefined;
  const first = render(
    React.createElement(RepoDiscoverApp, {
      root: 'repos',
      repos: REPOS,
      onDone: value => {
        selected = value;
      }
    })
  );

  try {
    await wait();
    first.stdin.write(SPACE);
    await wait();
    first.stdin.write(ENTER);
    await wait();
    assert.deepEqual(selected, []);
  } finally {
    first.unmount();
  }

  selected = [REPOS[0]];
  const second = render(
    React.createElement(RepoDiscoverApp, {
      root: 'repos',
      repos: REPOS,
      onDone: value => {
        selected = value;
      }
    })
  );

  try {
    await wait();
    second.stdin.write(ESCAPE);
    await wait();
    assert.equal(selected, undefined);
  } finally {
    second.unmount();
  }
});
