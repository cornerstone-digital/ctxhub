import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyIndexProgress, formatFileProgress } from './applyIndexProgress.js';
import type { RepoStatus } from './RepoStatusList.js';

function repos(): RepoStatus[] {
  return [{ name: 'app', state: 'queued' }, { name: 'web', state: 'queued' }];
}

test('formatFileProgress reports scanned/total and a rounded percentage', () => {
  assert.equal(formatFileProgress(0, 500), '0/500 files (0%)');
  assert.equal(formatFileProgress(142, 500), '142/500 files (28%)');
  assert.equal(formatFileProgress(500, 500), '500/500 files (100%)');
});

test('formatFileProgress falls back to a plain count when total is unknown', () => {
  assert.equal(formatFileProgress(12, 0), '12 files');
});

test('applyIndexProgress marks the matching repo active with file-progress detail, leaving others untouched', () => {
  const updated = applyIndexProgress(repos(), { type: 'repo-progress', repo: 'app', scanned: 142, total: 500 });
  assert.deepEqual(updated.find(r => r.name === 'app'), { name: 'app', state: 'active', detail: '142/500 files (28%)' });
  assert.deepEqual(updated.find(r => r.name === 'web'), { name: 'web', state: 'queued' });
});

test('applyIndexProgress transitions a repo through start -> progress -> done', () => {
  let state = repos();
  state = applyIndexProgress(state, { type: 'repo-start', repo: 'app' });
  assert.equal(state.find(r => r.name === 'app')?.state, 'active');

  state = applyIndexProgress(state, { type: 'repo-progress', repo: 'app', scanned: 3, total: 10 });
  assert.equal(state.find(r => r.name === 'app')?.detail, '3/10 files (30%)');

  state = applyIndexProgress(state, { type: 'repo-done', repo: 'app', scanned: 10, indexed: 4, skipped: 6 });
  const finalApp = state.find(r => r.name === 'app');
  assert.equal(finalApp?.state, 'done');
  assert.equal(finalApp?.detail, '10 scanned, 4 indexed, 6 skipped');
});
