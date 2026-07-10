import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendSuggestedEvalCases, evaluateAgentSuite, evaluateSuite, renderAgentEvalMarkdown, renderEvalMarkdown, suggestEvalQueries } from './eval.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig, SearchResult } from '../config/types.js';
import type { RunAgentResult } from '../llm/runAgent.js';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { saveManifest } from '../indexing/manifest.js';

function result(repo: string, filePath: string, score: number): SearchResult {
  return {
    id: `${repo}:${filePath}`,
    workspace: 'ws',
    repo,
    filePath,
    absolutePath: `/tmp/${repo}/${filePath}`,
    content: filePath,
    hash: 'hash',
    lastIndexed: '2026-07-09T00:00:00.000Z',
    score,
    snippet: filePath
  };
}

test('evaluateSuite records ranks, missing expectations, and top results', async () => {
  const run = await evaluateSuite({
    cases: [{
      query: 'auth',
      expected: [{ repo: 'api', path: 'README.md' }, { repo: 'web', path: 'missing.md' }]
    }]
  }, async () => [result('web', 'README.md', 2), result('api', 'README.md', 1)]);

  assert.equal(run.summary.total, 1);
  assert.equal(run.summary.passed, 0);
  assert.equal(run.summary.failed, 1);
  assert.equal(run.cases[0].expected[0].rank, 2);
  assert.deepEqual(run.cases[0].missing, [{ repo: 'web', path: 'missing.md' }]);
  assert.equal(run.cases[0].topResults.length, 2);
});

test('renderEvalMarkdown includes query status and actual ranks', async () => {
  const run = await evaluateSuite({
    cases: [{ query: 'auth', expected: [{ path: 'README.md' }] }]
  }, async () => [result('api', 'README.md', 3)], 'eval.json');

  const markdown = renderEvalMarkdown(run);
  assert.match(markdown, /ctxhub Eval Report/);
  assert.match(markdown, /PASS: auth/);
  assert.match(markdown, /rank 1/);
});

test('renderEvalMarkdown includes rationale when present', async () => {
  const run = await evaluateSuite({
    cases: [{ query: 'auth', expected: [{ path: 'README.md' }], rationale: 'Covers the main onboarding path.' }]
  }, async () => [result('api', 'README.md', 3)], 'eval.json');

  const markdown = renderEvalMarkdown(run);
  assert.match(markdown, /Rationale: Covers the main onboarding path\./);
});

function config(overrides: Partial<CtxhubConfig['llm']> = {}): CtxhubConfig {
  return { ...defaultConfig, llm: { ...defaultConfig.llm, ...overrides } };
}

function fakeRunAgentPromptFn(byQuestion: Record<string, RunAgentResult>) {
  return async (_config: CtxhubConfig, prompt: string): Promise<RunAgentResult> => {
    const question = Object.keys(byQuestion).find(q => prompt.includes(q));
    return question ? byQuestion[question] : { ok: false, reason: 'error', detail: 'unexpected question in test fake' };
  };
}

test('evaluateAgentSuite marks a case matched when the agent names the expected tool', async () => {
  const suite = { cases: [{ question: 'How does X authenticate with Y?', expectedTool: 'context_pack' }] };
  const run = await evaluateAgentSuite(
    suite,
    config({ enabled: true }),
    fakeRunAgentPromptFn({ 'How does X authenticate with Y?': { ok: true, text: 'context_pack' } })
  );
  assert.equal(run.summary.matched, 1);
  assert.equal(run.summary.unmatched, 0);
  assert.equal(run.cases[0].matched, true);
});

test('evaluateAgentSuite marks a case unmatched when the agent names a different tool', async () => {
  const suite = { cases: [{ question: 'How does this system fit together?', expectedTool: 'architecture_search' }] };
  const run = await evaluateAgentSuite(
    suite,
    config({ enabled: true }),
    fakeRunAgentPromptFn({ 'How does this system fit together?': { ok: true, text: 'search' } })
  );
  assert.equal(run.summary.matched, 0);
  assert.equal(run.summary.unmatched, 1);
  assert.equal(run.cases[0].agentAnswer, 'search');
});

test('evaluateAgentSuite records the failure reason for a case instead of throwing when the LLM call fails', async () => {
  const suite = { cases: [{ question: 'Where is X implemented?', expectedTool: 'search' }] };
  const run = await evaluateAgentSuite(
    suite,
    config({ enabled: true }),
    async () => ({ ok: false, reason: 'timeout' })
  );
  assert.equal(run.cases[0].matched, false);
  assert.equal(run.cases[0].error, 'timeout');
});

test('renderAgentEvalMarkdown distinguishes MATCH/MISMATCH/SKIPPED cases', () => {
  const markdown = renderAgentEvalMarkdown({
    generatedAt: '2026-07-10T00:00:00.000Z',
    summary: { total: 3, matched: 1, unmatched: 2 },
    cases: [
      { question: 'q1', expectedTool: 'context_pack', agentAnswer: 'context_pack', matched: true },
      { question: 'q2', expectedTool: 'search', agentAnswer: 'context_pack', matched: false },
      { question: 'q3', expectedTool: 'search', matched: false, error: 'disabled' }
    ]
  });
  assert.match(markdown, /MATCH: q1/);
  assert.match(markdown, /MISMATCH: q2/);
  assert.match(markdown, /SKIPPED: q3/);
});

test('suggestEvalQueries reports the disabled notice and no suggestions when llm.enabled is false', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-eval-suggest-'));
  try {
    await saveManifest({
      version: 1,
      workspace: 'ws',
      files: {
        'api:README.md': {
          repo: 'api',
          filePath: 'README.md',
          absolutePath: '/tmp/api/README.md',
          hash: 'hash',
          indexedAt: '2026-07-10T00:00:00.000Z',
          chunkIds: ['1']
        }
      }
    }, cwd);

    const result = await suggestEvalQueries({ cases: [] }, config({ enabled: false }), cwd);
    assert.deepEqual(result.suggestions, []);
    assert.match(result.llmNotice ?? '', /llm\.enabled: true/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('suggestEvalQueries parses structured cases with rationale from the LLM response', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-eval-suggest-'));
  try {
    await saveManifest({
      version: 1,
      workspace: 'ws',
      files: {
        'api:README.md': {
          repo: 'api',
          filePath: 'README.md',
          absolutePath: '/tmp/api/README.md',
          hash: 'hash',
          indexedAt: '2026-07-10T00:00:00.000Z',
          chunkIds: ['1']
        }
      }
    }, cwd);

    const result = await suggestEvalQueries(
      { cases: [] },
      config({ enabled: true }),
      cwd,
      async () => ({ ok: true, text: '{"cases":[{"query":"How does auth work?","expected":[{"repo":"api","path":"README.md"}],"rationale":"Covers the main auth path."}]}' })
    );

    assert.deepEqual(result.suggestions, [{
      query: 'How does auth work?',
      expected: [{ repo: 'api', path: 'README.md' }],
      rationale: 'Covers the main auth path.'
    }]);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test('appendSuggestedEvalCases appends only new queries and leaves existing ones intact', () => {
  const { suite, added } = appendSuggestedEvalCases(
    { cases: [{ query: 'How does auth work?', expected: [{ repo: 'api', path: 'README.md' }] }] },
    [
      { query: 'How does auth work?', expected: [{ repo: 'api', path: 'README.md' }], rationale: 'duplicate' },
      { query: 'Where is rate limiting?', expected: [{ repo: 'api', path: 'src/rate-limit.ts' }], rationale: 'new' }
    ]
  );

  assert.equal(added.length, 1);
  assert.equal(added[0].query, 'Where is rate limiting?');
  assert.equal(suite.cases.length, 2);
});
