import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import React from 'react';
import { render } from 'ink-testing-library';
import { SearchApp } from './SearchApp.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';

const ENTER = '\r';
const ESCAPE = '\u001B';

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForFrame(lastFrame: () => string | undefined, pattern: RegExp, timeoutMs = 1500): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const frame = lastFrame() ?? '';
    if (pattern.test(frame)) return frame;
    await wait(25);
  }
  return lastFrame() ?? '';
}

async function withIndexedWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-tui-'));
  try {
    await initConfig('tui-ws', cwd);

    const repoPath = path.join(cwd, 'app');
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, 'README.md'), '# App\n\n## Authentication flow\n\nAuth details live here.\n');
    await writeFile(
      path.join(repoPath, 'auth.ts'),
      ['export function authenticateRequest(token: string) {', '  return token.length > 0;', '}'].join('\n')
    );

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, cwd);

    await indexWorkspace(cwd);
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test('SearchApp renders live search results as the query is typed', () => {
  return withIndexedWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const { stdin, lastFrame, unmount } = render(
      React.createElement(SearchApp, { config, cwd, initialQuery: '', limit: 5 })
    );

    try {
      stdin.write('auth');

      const frame = await waitForFrame(lastFrame, /README\.md/);
      assert.match(frame, /app/);
      assert.match(frame, /README\.md/);
      assert.match(frame, /Preview/);
      assert.match(frame, /Snippet/);
      assert.match(frame, /\[docs\]/);
      assert.match(frame, /ctxhub open/);
    } finally {
      unmount();
    }
  });
});

test('SearchApp facets filter results to code', () => {
  return withIndexedWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const { lastFrame, unmount } = render(
      React.createElement(SearchApp, { config, cwd, initialQuery: 'authenticateRequest', limit: 5, initialFacet: 'code' })
    );

    try {
      const frame = await waitForFrame(lastFrame, /auth\.ts/);
      assert.match(frame, /\[code\]/);
      assert.match(frame, /local follow-up: rg "authenticateRequest" app/);
      assert.doesNotMatch(frame, /README\.md/);
    } finally {
      unmount();
    }
  });
});

test('SearchApp shows the full chunk on enter and returns to the list on escape', () => {
  return withIndexedWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const { stdin, lastFrame, unmount } = render(
      React.createElement(SearchApp, { config, cwd, initialQuery: 'auth', limit: 5, initialFacet: 'docs' })
    );

    try {
      await waitForFrame(lastFrame, /README\.md/);
      stdin.write(ENTER);
      await waitForFrame(lastFrame, /back to results/);

      const detailFrame = lastFrame() ?? '';
      assert.match(detailFrame, /Auth details live here\./);
      assert.match(detailFrame, /back to results/);

      stdin.write(ESCAPE);
      await wait(50);

      const listFrame = lastFrame() ?? '';
      assert.match(listFrame, /move · enter full chunk · tab result type · esc quit/);
    } finally {
      unmount();
    }
  });
});

test('SearchApp shows no results for an empty query and stays quiet', () => {
  return withIndexedWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const { lastFrame, unmount } = render(
      React.createElement(SearchApp, { config, cwd, initialQuery: '', limit: 5 })
    );

    try {
      const frame = lastFrame() ?? '';
      assert.doesNotMatch(frame, /no results/);
      assert.doesNotMatch(frame, /README\.md/);
    } finally {
      unmount();
    }
  });
});
