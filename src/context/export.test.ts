import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseContextPackArtifact, stripAbsolutePaths } from './export.js';

test('stripAbsolutePaths removes nested absolutePath keys', () => {
  const stripped = stripAbsolutePaths({
    query: 'auth',
    search: [{ filePath: 'README.md', absolutePath: '/tmp/repo/README.md' }],
    nested: { absolutePath: '/tmp/secret', keep: true }
  });

  assert.deepEqual(stripped, {
    query: 'auth',
    search: [{ filePath: 'README.md' }],
    nested: { keep: true }
  });
});

test('parseContextPackArtifact rejects invalid artifacts', () => {
  assert.throws(() => parseContextPackArtifact(JSON.stringify({ schemaVersion: 1 })), /Invalid ctxhub/);
});
