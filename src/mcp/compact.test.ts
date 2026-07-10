import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decode } from '@toon-format/toon';
import { compactEncode } from './compact.js';

// JSON.parse reliably throws on real TOON text; TOON's decode() is lenient enough to
// "succeed" on plain JSON text with silently wrong results instead of throwing -- so JSON.parse
// must be tried first.
function decodeEither(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return decode(text);
  }
}

test('compactEncode drops redundant full content when a snippet sibling exists', () => {
  const value = { id: 'a1', content: 'x'.repeat(2000), snippet: 'short preview' };
  const text = compactEncode(value);
  assert.ok(!text.includes('x'.repeat(2000)), 'full content should be stripped');
  assert.ok(text.includes('short preview'));
});

test('compactEncode keeps content when there is no sibling snippet (open_chunk/get_file_context shape)', () => {
  const value = { id: 'a1', content: 'the full document body', path: 'README.md' };
  const decoded = decodeEither(compactEncode(value)) as { content: string };
  assert.equal(decoded.content, 'the full document body');
});

test('compactEncode strips redundant content recursively through nested arrays', () => {
  const value = {
    search: [
      { id: '1', content: 'x'.repeat(500), snippet: 'preview one' },
      { id: '2', content: 'y'.repeat(500), snippet: 'preview two' }
    ]
  };
  const text = compactEncode(value);
  assert.ok(!text.includes('x'.repeat(500)));
  assert.ok(!text.includes('y'.repeat(500)));
  assert.ok(text.includes('preview one') && text.includes('preview two'));
});

test('compactEncode round-trips through whichever format it picks', () => {
  const value = {
    query: 'authenticate',
    results: [
      { id: '1', repo: 'app', score: 0.9, snippet: 'a' },
      { id: '2', repo: 'app', score: 0.8, snippet: 'b' },
      { id: '3', repo: 'app', score: 0.7, snippet: 'c' }
    ]
  };
  const decoded = decodeEither(compactEncode(value)) as typeof value;
  assert.deepEqual(decoded, value);
});

test('compactEncode picks a genuinely smaller encoding than pretty-printed JSON for uniform result arrays', () => {
  const value = {
    results: Array.from({ length: 10 }, (_, i) => ({ id: `${i}`, repo: 'app', path: `file${i}.ts`, score: 0.5, snippet: `preview ${i}` }))
  };
  const pretty = JSON.stringify(value, null, 2);
  const compact = compactEncode(value);
  assert.ok(compact.length < pretty.length);
});

test('compactEncode falls back to compact JSON for non-uniform/deeply nested shapes without losing data', () => {
  const value = {
    query: 'x',
    status: { memory: { provider: 'mempalace', documentCount: 3 }, index: { provider: 'lancedb', chunkCount: 12 } },
    guidance: ['one', 'two', 'three']
  };
  const decoded = decodeEither(compactEncode(value)) as typeof value;
  assert.deepEqual(decoded, value);
});
