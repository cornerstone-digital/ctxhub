import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSuite, renderEvalMarkdown } from './eval.js';
import type { SearchResult } from '../config/types.js';

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
