import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { diagramAddCommand, synthesizeDiagramDraft } from './diagram.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig } from '../config/types.js';
import { pathExists, readText } from '../utils/fs.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-diagram-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);
    await mkdir(path.join(cwd, 'app'), { recursive: true });

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });
    await saveConfig(config, cwd);

    process.chdir(cwd);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

function config(overrides: Partial<CtxhubConfig['llm']> = {}): CtxhubConfig {
  return { ...defaultConfig, llm: { ...defaultConfig.llm, ...overrides } };
}

test('diagramAddCommand creates a dated Mermaid diagram under docs/architecture', () => {
  return withWorkspace(async cwd => {
    await diagramAddCommand('app', 'Runtime topology', { agent: 'codex' });

    const today = new Date().toISOString().slice(0, 10);
    const diagramPath = path.join(cwd, 'app', 'docs', 'architecture', `${today}-runtime-topology.mmd`);
    assert.equal(await pathExists(diagramPath), true);

    const content = await readText(diagramPath);
    assert.match(content, /%% title: Runtime topology/);
    assert.match(content, /%% agent: codex/);
    assert.match(content, /flowchart TD/);
  });
});

test('diagramAddCommand rejects an unknown repo and refuses overwrite', () => {
  return withWorkspace(async () => {
    await assert.rejects(() => diagramAddCommand('missing', 'Runtime topology'), /Repository not found: missing/);
    await diagramAddCommand('app', 'Runtime topology');
    await assert.rejects(() => diagramAddCommand('app', 'Runtime topology'), /already exists/);
  });
});

test('synthesizeDiagramDraft reports the disabled notice and no content when llm.enabled is false', async () => {
  const result = await synthesizeDiagramDraft({
    repoName: 'app',
    title: 'Runtime topology',
    agent: 'codex',
    date: '2026-07-10',
    diagramType: 'flowchart',
    evidence: ['app:docs/architecture/runtime.mmd'],
    recentCommits: ['abc123 feat: add runtime docs']
  }, config({ enabled: false }));

  assert.equal(result.content, undefined);
  assert.match(result.llmNotice ?? '', /llm\.enabled: true/);
});

test('synthesizeDiagramDraft returns an AI-drafted diagram and strips mermaid fences', async () => {
  const result = await synthesizeDiagramDraft(
    {
      repoName: 'app',
      title: 'Runtime topology',
      agent: 'codex',
      date: '2026-07-10',
      diagramType: 'flowchart',
      evidence: ['app:docs/architecture/runtime.mmd'],
      recentCommits: ['abc123 feat: add runtime docs']
    },
    config({ enabled: true }),
    async () => ({ ok: true, text: '```mermaid\nService --> Database\n```' })
  );

  assert.match(result.content ?? '', /%% AI draft: review every node, edge, and label before merge\./);
  assert.match(result.content ?? '', /flowchart TD\nService --> Database/);
  assert.doesNotMatch(result.content ?? '', /```/);
  assert.equal(result.llmNotice, undefined);
});

test('synthesizeDiagramDraft falls back with a clear notice when the LLM call fails', async () => {
  const result = await synthesizeDiagramDraft(
    {
      repoName: 'app',
      title: 'Runtime topology',
      agent: 'codex',
      date: '2026-07-10',
      diagramType: 'flowchart',
      evidence: ['app:docs/architecture/runtime.mmd'],
      recentCommits: ['abc123 feat: add runtime docs']
    },
    config({ enabled: true }),
    async () => ({ ok: false, reason: 'timeout' })
  );

  assert.equal(result.content, undefined);
  assert.match(result.llmNotice ?? '', /unavailable \(timeout\)/);
});
