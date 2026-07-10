import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveExecutionProfile } from './executionProfile.js';
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
