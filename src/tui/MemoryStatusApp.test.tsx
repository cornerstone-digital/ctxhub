import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { MemoryStatusApp } from './MemoryStatusApp.js';
import type { IndexStatus, MemoryStatus } from '../config/types.js';

const ENTER = '\r';

function wait(ms = 30): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const memory: MemoryStatus = {
  provider: 'local-json',
  documentCount: 2,
  chunkCount: 2,
  indexLocation: '.ctxhub/memory/local.json',
  lastIndexed: '2026-07-09T00:00:00.000Z'
};

test('MemoryStatusApp renders memory and index status panels', async () => {
  const index: IndexStatus = {
    provider: 'local-json',
    documentCount: 3,
    chunkCount: 3,
    indexLocation: '.ctxhub/index/local.json',
    lastIndexed: '2026-07-09T00:00:00.000Z'
  };

  let closed = false;
  const { stdin, lastFrame, unmount } = render(
    React.createElement(MemoryStatusApp, {
      memory,
      index,
      onExit: () => {
        closed = true;
      }
    })
  );

  try {
    await wait();
    const frame = lastFrame() ?? '';
    assert.match(frame, /ctxhub memory status/);
    assert.match(frame, /Memory/);
    assert.match(frame, /Index/);
    assert.match(frame, /index ready/);

    stdin.write(ENTER);
    await wait();
    assert.equal(closed, true);
  } finally {
    unmount();
  }
});

test('MemoryStatusApp suggests indexing when the index is empty', async () => {
  const index: IndexStatus = {
    provider: 'local-json',
    documentCount: 0,
    chunkCount: 0,
    indexLocation: '.ctxhub/index/local.json'
  };

  const { lastFrame, unmount } = render(React.createElement(MemoryStatusApp, { memory, index }));
  try {
    await wait();
    const frame = lastFrame() ?? '';
    assert.match(frame, /index empty/);
    assert.match(frame, /Run ctxhub index/);
  } finally {
    unmount();
  }
});
