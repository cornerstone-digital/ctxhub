import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractJsonPayload } from './mempalaceCli.js';

test('extractJsonPayload parses clean JSON on stdout (mempalace.searcher-style output)', () => {
  const result = extractJsonPayload('{"query":"jwt","results":[]}\n', '');
  assert.deepEqual(result, { query: 'jwt', results: [] });
});

test('extractJsonPayload parses clean JSON on stderr when stdout is empty', () => {
  const result = extractJsonPayload('', '{"entity":"all","timeline":[],"count":0}\n');
  assert.deepEqual(result, { entity: 'all', timeline: [], count: 0 });
});

test('extractJsonPayload finds the JSON line on stderr when it is preceded by unrelated log noise', () => {
  // Reproduces the real bug: mempalace.mcp_server (used by timeline/add-drawer/diary-write)
  // redirects stdout for MCP-protocol hygiene, so its own log lines and the JSON print both
  // land on stderr, with stdout empty.
  const stderr = [
    'Embedding function initialized (model=minilm device=coreml providers=[...])',
    'Filed drawer: drawer_proj_general_f1a04f100968ea73c5decfa3 → proj/general',
    '{"success": true, "drawer_id": "drawer_proj_general_f1a04f100968ea73c5decfa3", "wing": "proj", "room": "general", "chunks": 1}'
  ].join('\n');

  const result = extractJsonPayload('', stderr);
  assert.deepEqual(result, {
    success: true,
    drawer_id: 'drawer_proj_general_f1a04f100968ea73c5decfa3',
    wing: 'proj',
    room: 'general',
    chunks: 1
  });
});

test('extractJsonPayload takes the last valid-JSON line when more than one line parses', () => {
  const stderr = '{"stale": true}\n{"success": true}';
  const result = extractJsonPayload('', stderr);
  assert.deepEqual(result, { success: true });
});

test('extractJsonPayload returns undefined when neither stream contains any valid JSON', () => {
  const result = extractJsonPayload('', 'Traceback (most recent call last):\nRuntimeError: boom');
  assert.equal(result, undefined);
});

test('extractJsonPayload prefers a clean whole-stream parse over line-scanning when both streams are empty of noise', () => {
  // A multi-line pretty-printed JSON body would fail the line-by-line scan (each line alone
  // isn't valid JSON) but must still be recovered by the whole-stream attempt.
  const stdout = '{\n  "ok": true\n}';
  const result = extractJsonPayload(stdout, '');
  assert.deepEqual(result, { ok: true });
});
