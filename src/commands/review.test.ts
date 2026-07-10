import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { reviewCommand, synthesizeReviewFindings } from './review.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { runGit } from '../git/git.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig } from '../config/types.js';
import type { RunAgentResult } from '../llm/runAgent.js';

function config(overrides: Partial<CtxhubConfig['llm']> = {}): CtxhubConfig {
  return { ...defaultConfig, llm: { ...defaultConfig.llm, ...overrides } };
}

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-review-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);

    const repoPath = path.join(cwd, 'app');
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, 'README.md'), '# App\n\nHow to set this up.\n');
    await writeFile(path.join(repoPath, 'architecture.mmd'), 'flowchart LR\n  app --> ghost-service\n');
    await runGit(['init'], repoPath);
    await runGit(['config', 'user.email', 'test@example.com'], repoPath);
    await runGit(['config', 'user.name', 'Test'], repoPath);
    await runGit(['add', '.'], repoPath);
    await runGit(['commit', '-m', 'init'], repoPath);
    await runGit(['branch', 'base'], repoPath);
    await writeFile(path.join(repoPath, 'README.md'), '# App\n\nHow to set this up.\n\nUpdated.\n');
    await runGit(['add', '.'], repoPath);
    await runGit(['commit', '-m', 'update readme'], repoPath);

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: true });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    config.memory.provider = 'local-json';
    await saveConfig(config, cwd);

    process.chdir(cwd);
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

test('reviewCommand (contract persona) reports changed files and falls back with a clear notice when llm.enabled is false', () => {
  return withWorkspace(async () => {
    const lines = await captureLog(() => reviewCommand('readme update', { as: 'contract', base: 'base', json: true }));
    const payload = JSON.parse(lines.join(''));

    assert.equal(payload.persona, 'contract');
    assert.deepEqual(payload.changed.app, ['README.md']);
    assert.deepEqual(payload.findings, []);
    assert.match(payload.llmNotice, /llm\.enabled: true/);
  });
});

test('reviewCommand (docs persona) surfaces architecture drift for an unrepresented component', () => {
  return withWorkspace(async cwd => {
    await indexWorkspace(cwd);
    const lines = await captureLog(() => reviewCommand('architecture', { as: 'docs', json: true }));
    const payload = JSON.parse(lines.join(''));

    assert.equal(payload.persona, 'docs');
    // "ghost-service" is named in the diagram but matches no configured repo/package -- exactly
    // the kind of drift `analyzeArchitectureDrift` (reused as-is here, not reimplemented) detects.
    assert.ok(payload.findings.some((finding: string) => finding.includes('ghost-service')));
  });
});

test('reviewCommand rejects an unknown persona at the CLI option level, not silently', () => {
  return withWorkspace(async () => {
    // @ts-expect-error -- deliberately passing an invalid persona to confirm gatherPersonaFindings' switch has no silent fallthrough
    await assert.rejects(() => reviewCommand('topic', { as: 'not-a-real-persona', json: true }));
  });
});

const emptyPack = { repos: [], architecture: [], search: [], suggestedReadingOrder: [], notes: [] } as unknown as Parameters<typeof synthesizeReviewFindings>[4];

test('synthesizeReviewFindings returns no findings and never calls the LLM when nothing changed', async () => {
  let called = false;
  const result = await synthesizeReviewFindings('bug-hunter', 'topic', new Map(), new Map(), emptyPack, config({ enabled: true }), async () => {
    called = true;
    return { ok: true, text: '- should not be used' };
  });
  assert.deepEqual(result.findings, []);
  assert.equal(called, false);
});

test('synthesizeReviewFindings reports the disabled notice and no findings when llm.enabled is false', async () => {
  const changed = new Map([['api', ['src/index.ts']]]);
  const result = await synthesizeReviewFindings('security', 'topic', changed, new Map(), emptyPack, config({ enabled: false }));
  assert.deepEqual(result.findings, []);
  assert.match(result.llmNotice ?? '', /llm\.enabled: true/);
});

test('synthesizeReviewFindings parses one finding per bullet line', async () => {
  const changed = new Map([['api', ['src/routes.ts']]]);
  const diffs = new Map([['api', '-app.get(url, handler)\n+app.get(userInput, handler)']]);
  const fake = async (): Promise<RunAgentResult> => ({
    ok: true,
    text: [
      '- api:src/routes.ts -- userInput is used directly as a route path without validation.',
      '- api:src/routes.ts -- missing authorization check before the handler runs.'
    ].join('\n')
  });

  const result = await synthesizeReviewFindings('security', 'routing change', changed, diffs, emptyPack, config({ enabled: true }), fake);

  assert.equal(result.findings.length, 2);
  assert.match(result.findings[0], /userInput/);
  assert.match(result.findings[1], /authorization/);
});

test('synthesizeReviewFindings falls back with a clear notice when the LLM call fails', async () => {
  const changed = new Map([['api', ['src/routes.ts']]]);
  const result = await synthesizeReviewFindings('performance', 'topic', changed, new Map(), emptyPack, config({ enabled: true }), async () => ({
    ok: false,
    reason: 'timeout'
  }));
  assert.deepEqual(result.findings, []);
  assert.match(result.llmNotice ?? '', /unavailable \(timeout\)/);
});

test('synthesizeReviewFindings returns no findings when the LLM reports nothing concrete', async () => {
  const changed = new Map([['api', ['src/routes.ts']]]);
  const result = await synthesizeReviewFindings('bug-hunter', 'topic', changed, new Map(), emptyPack, config({ enabled: true }), async () => ({
    ok: true,
    text: ''
  }));
  assert.deepEqual(result.findings, []);
});
