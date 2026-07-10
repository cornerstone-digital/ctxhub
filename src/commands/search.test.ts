import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { maybeRewriteSearchInput, searchCommand } from './search.js';
import { openCommand } from './open.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-search-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);

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

    process.chdir(cwd);
    await indexWorkspace(cwd);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

async function captureLog(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(' '));
  };
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

test('searchCommand prints ranked results for a one-shot query', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => searchCommand('authentication', {}));
    assert.ok(lines.some(line => line.includes('app')));
    assert.ok(lines.some(line => line.includes('README.md')));
    assert.ok(lines.some(line => line.includes('[docs]')));
    assert.ok(lines.some(line => /id [a-f0-9]{12}/.test(line)));
    assert.ok(lines.some(line => /open: ctxhub open [a-f0-9]{12}/.test(line)));
  });
});

test('searchCommand can filter to source code results and prints local rg follow-ups', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => searchCommand('authenticateRequest', { code: true }));
    assert.ok(lines.some(line => line.includes('auth.ts')));
    assert.ok(lines.some(line => line.includes('[code]')));
    assert.ok(lines.some(line => line.includes('function authenticateRequest')));
    assert.ok(lines.some(line => line.includes('Local follow-up')));
    assert.ok(lines.some(line => line.includes('rg "authenticateRequest" app')));
    assert.ok(!lines.some(line => line.includes('README.md')));
  });
});

test('searchCommand rejects conflicting result type shortcuts', () => {
  return withWorkspace(async () => {
    await assert.rejects(
      () => searchCommand('authentication', { code: true, docs: true }),
      /Choose only one search type flag/
    );
  });
});

test('openCommand accepts the short id printed by searchCommand', () => {
  return withWorkspace(async () => {
    const searchLines = await captureLog(() => searchCommand('authentication', {}));
    const shortId = searchLines.join('\n').match(/open: ctxhub open ([a-f0-9]{12})/)?.[1];
    assert.ok(shortId, 'expected search output to include a short open id');

    const openLines = await captureLog(() => openCommand(shortId));
    assert.ok(openLines.some(line => line.includes('Auth details live here.')));
  });
});

test('search and open work from inside a configured child repository', () => {
  return withWorkspace(async cwd => {
    process.chdir(path.join(cwd, 'app'));

    const searchLines = await captureLog(() => searchCommand('authentication', {}));
    assert.ok(searchLines.some(line => line.includes('app')));
    assert.ok(searchLines.some(line => line.includes('README.md')));

    const shortId = searchLines.join('\n').match(/open: ctxhub open ([a-f0-9]{12})/)?.[1];
    assert.ok(shortId, 'expected search output to include a short open id');

    const openLines = await captureLog(() => openCommand(shortId));
    assert.ok(openLines.some(line => line.includes('Auth details live here.')));
  });
});

test('indexWorkspace called from inside a child repository still updates the parent workspace index', () => {
  return withWorkspace(async cwd => {
    process.chdir(path.join(cwd, 'app'));
    await writeFile(path.join(cwd, 'app', 'nested.md'), '# Nested\n\nIndexed from the child cwd.\n');

    await indexWorkspace(process.cwd());
    const lines = await captureLog(() => searchCommand('child cwd', {}));
    assert.ok(lines.some(line => line.includes('nested.md')));
  });
});

test('searchCommand throws a clear error with no query and no --interactive', () => {
  return withWorkspace(async () => {
    await assert.rejects(
      () => searchCommand(undefined, {}),
      /Provide a query, or pass --interactive/
    );
  });
});

test('searchCommand --interactive throws a clear error outside a real terminal instead of crashing', () => {
  return withWorkspace(async () => {
    assert.equal(process.stdin.isTTY, undefined, 'test runner stdin should not be a TTY');
    await assert.rejects(
      () => searchCommand('authentication', { interactive: true }),
      /--interactive needs a real terminal/
    );
  });
});

test('maybeRewriteSearchInput returns a disabled notice and leaves the query unchanged when llm.enabled is false', async () => {
  const config = await loadConfig(process.cwd()).catch(() => undefined);
  const result = await maybeRewriteSearchInput(
    'auth flow',
    'all',
    { ...(config ?? { workspace: { name: 'ws' }, repositories: [], knowledge: { include: [], exclude: [] }, memory: { provider: 'mempalace', path: '' }, index: { provider: 'local-json', path: '', table: '', incremental: true, chunkSize: 1000 }, hooks: {}, privacy: { redactPatterns: [] }, llm: { enabled: false, timeoutMs: 1000 }, version: 1 }) },
    async () => ({ ok: false, reason: 'disabled' })
  );
  assert.equal(result.query, 'auth flow');
  assert.equal(result.facet, 'all');
  assert.match(result.notice ?? '', /llm\.enabled: true/);
});

test('searchCommand surfaces both original and rewritten query when rewrite-query changes them', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    await saveConfig(config, cwd);

    const lines = await captureLog(() => searchCommand(
      'auth',
      { rewriteQuery: true },
      { runAgentPromptFn: async () => ({ ok: true, text: '{"query":"authenticateRequest","type":"code"}' }) }
    ));

    assert.ok(lines.some(line => line.includes('Original query: auth (all)')));
    assert.ok(lines.some(line => line.includes('Rewritten query: authenticateRequest (code)')));
    assert.ok(lines.some(line => line.includes('auth.ts')));
    assert.ok(!lines.some(line => line.includes('README.md')));
  });
});
