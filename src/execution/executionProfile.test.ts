import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExecutionProfile, runAgentPromptFnForProfile } from './executionProfile.js';
import { runAgentPrompt } from '../llm/runAgent.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig } from '../config/types.js';

test('resolveExecutionProfile returns undefined for a name not in config.executionProfiles', () => {
  const config: CtxhubConfig = { ...defaultConfig, executionProfiles: {} };
  assert.equal(resolveExecutionProfile(config, 'architect-primary'), undefined);
});

test('resolveExecutionProfile returns the matching profile', () => {
  const config: CtxhubConfig = {
    ...defaultConfig,
    executionProfiles: {
      'architect-primary': { persona: 'architect', runtime: 'claude', model: 'claude-opus-4', tags: ['premium'] }
    }
  };
  assert.deepEqual(resolveExecutionProfile(config, 'architect-primary'), {
    persona: 'architect',
    runtime: 'claude',
    model: 'claude-opus-4',
    tags: ['premium']
  });
});

// docs/control-plane.md Phase 7: 'direct-api' profiles route through a gateway instead of a
// harness CLI, picked once up front so callers don't need to branch per call.
test('runAgentPromptFnForProfile returns the real runAgentPrompt for a harness-runtime profile and for no profile at all', () => {
  assert.equal(runAgentPromptFnForProfile(undefined), runAgentPrompt);
  assert.equal(runAgentPromptFnForProfile({ runtime: 'claude', model: 'claude-opus-4' }), runAgentPrompt);
});

test("runAgentPromptFnForProfile's direct-api function calls the gateway and honors config.llm.enabled", async () => {
  const fn = runAgentPromptFnForProfile({
    runtime: 'direct-api',
    model: 'gpt-test',
    gateway: { baseUrl: 'https://api.example.com/v1' }
  });

  const disabledResult = await fn({ ...defaultConfig, llm: { ...defaultConfig.llm, enabled: false } }, 'prompt');
  assert.deepEqual(disabledResult, { ok: false, reason: 'disabled' });

  // Reserved, unassigned local port (127.0.0.1:1) -- guarantees an immediate ECONNREFUSED rather
  // than a real network hit or a slow DNS/TLS timeout, while still proving the gateway path
  // actually attempts a real connection rather than silently no-op'ing.
  const localFn = runAgentPromptFnForProfile({
    runtime: 'direct-api',
    model: 'gpt-test',
    gateway: { baseUrl: 'http://127.0.0.1:1' }
  });
  const enabledResult = await localFn({ ...defaultConfig, llm: { ...defaultConfig.llm, enabled: true, timeoutMs: 2000 } }, 'prompt');
  assert.equal(enabledResult.ok, false);
});

test('runAgentPromptFnForProfile reports a clear error for a direct-api profile missing gateway or model', async () => {
  const missingGateway = runAgentPromptFnForProfile({ runtime: 'direct-api', model: 'gpt-test' });
  const gatewayResult = await missingGateway({ ...defaultConfig, llm: { ...defaultConfig.llm, enabled: true } }, 'prompt');
  assert.equal(gatewayResult.ok, false);
  assert.match((gatewayResult as { detail: string }).detail, /must set a gateway/);

  const missingModel = runAgentPromptFnForProfile({ runtime: 'direct-api', gateway: { baseUrl: 'https://api.example.com/v1' } });
  const modelResult = await missingModel({ ...defaultConfig, llm: { ...defaultConfig.llm, enabled: true } }, 'prompt');
  assert.equal(modelResult.ok, false);
  assert.match((modelResult as { detail: string }).detail, /must set a model/);
});
