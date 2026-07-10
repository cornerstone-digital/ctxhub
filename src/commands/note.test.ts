import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { noteAddCommand, notePromoteCommand, synthesizeNoteDraft } from './note.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig } from '../config/types.js';
import { readText, pathExists } from '../utils/fs.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-note-'));
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

test('noteAddCommand creates a dated, slugified note file under <repo>/agent-notes/', () => {
  return withWorkspace(async cwd => {
    await noteAddCommand('app', 'Why we switched the MCP transport', { agent: 'claude' });

    const today = new Date().toISOString().slice(0, 10);
    const notePath = path.join(cwd, 'app', 'agent-notes', `${today}-why-we-switched-the-mcp-transport.md`);
    assert.equal(await pathExists(notePath), true);

    const content = await readText(notePath);
    assert.match(content, /^---\nagent: claude\ndate: \d{4}-\d{2}-\d{2}\n---/);
    assert.match(content, /# Why we switched the MCP transport/);
    assert.match(content, /MemPalace/);
  });
});

test('noteAddCommand defaults the agent field when not provided', () => {
  return withWorkspace(async cwd => {
    await noteAddCommand('app', 'Untitled finding');

    const today = new Date().toISOString().slice(0, 10);
    const content = await readText(path.join(cwd, 'app', 'agent-notes', `${today}-untitled-finding.md`));
    assert.match(content, /^---\nagent: unknown\n/);
  });
});

test('noteAddCommand rejects an unknown repo', () => {
  return withWorkspace(async () => {
    await assert.rejects(() => noteAddCommand('not-a-repo', 'Some title'), /Repository not found: not-a-repo/);
  });
});

test('noteAddCommand refuses to overwrite an existing note with the same title and date', () => {
  return withWorkspace(async () => {
    await noteAddCommand('app', 'Duplicate title');
    await assert.rejects(() => noteAddCommand('app', 'Duplicate title'), /already exists/);
  });
});

test('notePromoteCommand promotes the top MemPalace hit into a git-tracked note verbatim (NEXT_FEATURES #26)', () => {
  return withWorkspace(async cwd => {
    await notePromoteCommand('app', 'why graphql', {}, {
      searchMempalaceFn: async () => ({
        query: 'why graphql',
        results: [{ wing: 'app', room: 'decisions', text: 'We switched to GraphQL for schema evolution and client-driven queries.' }]
      })
    });

    const today = new Date().toISOString().slice(0, 10);
    const notePath = path.join(cwd, 'app', 'agent-notes', `${today}-we-switched-to-graphql-for-schema-evolution-and-client-drive.md`);
    assert.equal(await pathExists(notePath), true);

    const content = await readText(notePath);
    assert.match(content, /^---\nagent: unknown\ndate: \d{4}-\d{2}-\d{2}\npromoted-from: mempalace:app\/decisions\n---/);
    assert.match(content, /We switched to GraphQL for schema evolution and client-driven queries\./);
    assert.match(content, /Promoted from durable MemPalace memory \(app \/ decisions\)/);
  });
});

test('notePromoteCommand uses an explicit --hit index and --title override', () => {
  return withWorkspace(async cwd => {
    await notePromoteCommand('app', 'graphql', { hit: '1', title: 'Custom title', agent: 'claude' }, {
      searchMempalaceFn: async () => ({
        query: 'graphql',
        results: [
          { wing: 'app', room: 'decisions', text: 'First hit, not the one we want.' },
          { wing: 'app', room: 'decisions', text: 'Second hit, the one we actually want.' }
        ]
      })
    });

    const today = new Date().toISOString().slice(0, 10);
    const notePath = path.join(cwd, 'app', 'agent-notes', `${today}-custom-title.md`);
    const content = await readText(notePath);
    assert.match(content, /^---\nagent: claude\n/);
    assert.match(content, /Second hit, the one we actually want\./);
    assert.ok(!content.includes('First hit'));
  });
});

test('notePromoteCommand rejects an unknown repo and a missing hit', () => {
  return withWorkspace(async () => {
    await assert.rejects(
      () => notePromoteCommand('not-a-repo', 'query', {}, { searchMempalaceFn: async () => ({ query: 'query', results: [] }) }),
      /Repository not found: not-a-repo/
    );
    await assert.rejects(
      () => notePromoteCommand('app', 'query', {}, { searchMempalaceFn: async () => ({ query: 'query', results: [] }) }),
      /No MemPalace memory hit found at index 0/
    );
  });
});

test('synthesizeNoteDraft reports the disabled notice and no content when llm.enabled is false', async () => {
  const result = await synthesizeNoteDraft({
    repoName: 'app',
    title: 'Runtime topology',
    agent: 'claude',
    date: '2026-07-10',
    evidence: ['app:README.md'],
    recentCommits: ['abc123 feat: add runtime docs']
  }, config({ enabled: false }));

  assert.equal(result.content, undefined);
  assert.match(result.llmNotice ?? '', /llm\.enabled: true/);
});

test('synthesizeNoteDraft returns AI-drafted content when the LLM call succeeds', async () => {
  const result = await synthesizeNoteDraft(
    {
      repoName: 'app',
      title: 'Runtime topology',
      agent: 'claude',
      date: '2026-07-10',
      evidence: ['app:README.md'],
      recentCommits: ['abc123 feat: add runtime docs']
    },
    config({ enabled: true }),
    async () => ({ ok: true, text: 'This change routes traffic through app:README.md.' })
  );

  assert.match(result.content ?? '', /^---\nagent: claude\ndate: 2026-07-10\ndraft: ai-pending-review\n---/);
  assert.match(result.content ?? '', /AI draft: review every claim and edit before merge/);
  assert.match(result.content ?? '', /This change routes traffic through app:README\.md\./);
  assert.equal(result.llmNotice, undefined);
});

test('synthesizeNoteDraft falls back with a clear notice when the LLM call fails', async () => {
  const result = await synthesizeNoteDraft(
    {
      repoName: 'app',
      title: 'Runtime topology',
      agent: 'claude',
      date: '2026-07-10',
      evidence: ['app:README.md'],
      recentCommits: ['abc123 feat: add runtime docs']
    },
    config({ enabled: true }),
    async () => ({ ok: false, reason: 'timeout' })
  );

  assert.equal(result.content, undefined);
  assert.match(result.llmNotice ?? '', /unavailable \(timeout\)/);
});
