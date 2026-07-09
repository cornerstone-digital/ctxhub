import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildAnswerLines, type ExplainEvidence } from './explain.js';

test('buildAnswerLines produces a no-evidence scaffold', () => {
  assert.deepEqual(buildAnswerLines([]), [
    'No indexed evidence matched this query. Run ctxhub index or broaden the query.'
  ]);
});

test('buildAnswerLines cites architecture and context evidence refs', () => {
  const evidence: ExplainEvidence[] = [
    {
      ref: 'E1',
      repo: 'api',
      path: 'docs/architecture/runtime.mmd',
      snippet: 'api --> web',
      stale: false,
      kind: 'architecture'
    },
    {
      ref: 'E2',
      repo: 'api',
      path: 'README.md',
      snippet: 'auth details',
      stale: false,
      kind: 'context'
    }
  ];

  const lines = buildAnswerLines(evidence);
  assert.match(lines[0], /\[E1\]/);
  assert.match(lines[1], /\[E2\]/);
  assert.match(lines[2], /source of truth/);
});
