import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildHandoffMarkdown, defaultHandoffPath, slugify, synthesizeHandoffSummary } from './handoff.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig } from '../config/types.js';

const basePack = {
  query: 'auth flow',
  workspace: 'ws',
  generatedAt: '2026-07-09T00:00:00.000Z',
  repos: [{ name: 'api', path: './api' }],
  status: {
    index: { provider: 'local-json' as const, documentCount: 1, chunkCount: 2, indexLocation: '.ctxhub/index' },
    memory: { provider: 'local-json' as const, documentCount: 0, chunkCount: 0, indexLocation: '.ctxhub/memory' }
  },
  search: [{
    id: '1',
    workspace: 'ws',
    repo: 'api',
    filePath: 'README.md',
    absolutePath: '/tmp/api/README.md',
    content: 'content',
    hash: 'hash',
    lastIndexed: '2026-07-09T00:00:00.000Z',
    score: 1,
    snippet: 'Authentication flow lives here.',
    title: 'Auth'
  }],
  architecture: [{
    id: '2',
    workspace: 'ws',
    repo: 'api',
    filePath: 'docs/architecture/runtime.mmd',
    absolutePath: '/tmp/api/docs/architecture/runtime.mmd',
    kind: 'architecture-diagram' as const,
    diagramType: 'flowchart',
    relationships: ['api --> web'],
    content: 'diagram',
    hash: 'hash',
    lastIndexed: '2026-07-09T00:00:00.000Z',
    score: 1,
    snippet: 'diagram'
  }],
  suggestedReadingOrder: [{ repo: 'api', path: 'docs/architecture/runtime.mmd', title: 'Mermaid flowchart' }],
  guidance: []
};

test('slugify creates a safe handoff slug', () => {
  assert.equal(slugify('Auth Flow / Webhooks!'), 'auth-flow-webhooks');
});

test('defaultHandoffPath writes under the ctxhub handoff cache', () => {
  assert.equal(
    defaultHandoffPath('Auth Flow', new Date('2026-07-09T12:34:56.000Z')),
    '.ctxhub/cache/handoffs/2026-07-09T12-34-56-000Z-auth-flow.md'
  );
});

test('buildHandoffMarkdown includes status, changed files, architecture, and context', () => {
  const markdown = buildHandoffMarkdown({
    topic: 'auth flow',
    base: 'origin/main',
    changed: { api: ['README.md'] },
    pack: basePack
  });

  assert.match(markdown, /^# Handoff: auth flow/);
  assert.match(markdown, /Changed Files vs origin\/main/);
  assert.match(markdown, /docs\/architecture\/runtime\.mmd/);
  assert.match(markdown, /Authentication flow lives here/);
});

test('buildHandoffMarkdown includes a Summary section only when one is provided', () => {
  const withoutSummary = buildHandoffMarkdown({ topic: 'auth flow', changed: {}, pack: basePack });
  assert.ok(!withoutSummary.includes('## Summary'));

  const withSummary = buildHandoffMarkdown({ topic: 'auth flow', changed: {}, pack: basePack, summary: 'Auth lives in api:README.md.' });
  assert.match(withSummary, /## Summary\n\nAuth lives in api:README\.md\./);
});

function config(overrides: Partial<CtxhubConfig['llm']> = {}): CtxhubConfig {
  return { ...defaultConfig, llm: { ...defaultConfig.llm, ...overrides } };
}

test('synthesizeHandoffSummary reports the disabled notice and no summary when llm.enabled is false', async () => {
  const result = await synthesizeHandoffSummary({ topic: 'auth flow', changed: {}, pack: basePack }, config({ enabled: false }));
  assert.equal(result.summary, undefined);
  assert.match(result.llmNotice ?? '', /llm\.enabled: true/);
});

test('synthesizeHandoffSummary returns the synthesized text and no notice on success', async () => {
  const result = await synthesizeHandoffSummary(
    { topic: 'auth flow', changed: {}, pack: basePack },
    config({ enabled: true }),
    async () => ({ ok: true, text: '  Auth lives in api:README.md.  ' })
  );
  assert.equal(result.summary, 'Auth lives in api:README.md.');
  assert.equal(result.llmNotice, undefined);
});

test('synthesizeHandoffSummary falls back with a clear notice when the LLM call fails', async () => {
  const result = await synthesizeHandoffSummary(
    { topic: 'auth flow', changed: {}, pack: basePack },
    config({ enabled: true }),
    async () => ({ ok: false, reason: 'timeout' })
  );
  assert.equal(result.summary, undefined);
  assert.match(result.llmNotice ?? '', /unavailable \(timeout\)/);
});
