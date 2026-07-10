import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import type { CtxhubConfig } from '../config/types.js';
import type { RunAgentResult } from '../llm/runAgent.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { createAskResult } from './ask.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-ask-'));
  try {
    await initConfig('ws', cwd);
    await mkdir(path.join(cwd, 'app'), { recursive: true });
    await writeFile(path.join(cwd, 'app', 'README.md'), '# App\n\n## Authentication flow\n\nAuth details for testing.\n');

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, cwd);

    await indexWorkspace(cwd);
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function fakeRunAgentPromptFn(whenEnabled: RunAgentResult) {
  return async (config: CtxhubConfig): Promise<RunAgentResult> => (config.llm.enabled ? whenEnabled : { ok: false, reason: 'disabled' });
}

test('createAskResult returns a clear disabled notice when llm.enabled is false', () => {
  return withWorkspace(async cwd => {
    const result = await createAskResult('authentication flow', 8, cwd, {
      runAgentPromptFn: fakeRunAgentPromptFn({ ok: true, text: 'should not be used' })
    });

    assert.equal(result.answer, undefined);
    assert.match(result.unavailableNotice ?? '', /llm\.enabled: true/);
    assert.match(result.unavailableNotice ?? '', /ctxhub explain/);
  });
});

test('createAskResult returns the synthesized answer and citations when the LLM call succeeds', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    await saveConfig(config, cwd);

    const result = await createAskResult('authentication flow', 8, cwd, {
      runAgentPromptFn: fakeRunAgentPromptFn({ ok: true, text: 'Auth works via [E1] token validation.' })
    });

    assert.deepEqual(result.answer, ['Auth works via [E1] token validation.']);
    assert.equal(result.unavailableNotice, undefined);
    assert.ok(result.citations?.some(item => item.ref === 'E1'));
  });
});

test('createAskResult reports LLM unavailability instead of falling back to the scaffold', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    await saveConfig(config, cwd);

    const result = await createAskResult('authentication flow', 8, cwd, {
      runAgentPromptFn: fakeRunAgentPromptFn({ ok: false, reason: 'timeout' })
    });

    assert.equal(result.answer, undefined);
    assert.match(result.unavailableNotice ?? '', /unavailable \(timeout\)/);
    assert.match(result.unavailableNotice ?? '', /ctxhub explain/);
  });
});