import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCiEnvironment, shouldUseInteractive } from './interactive.js';

function withArgv<T>(argv: string[], run: () => T): T {
  const originalArgv = process.argv;
  process.argv = ['node', 'ctxhub', ...argv];
  try {
    return run();
  } finally {
    process.argv = originalArgv;
  }
}

test('isCiEnvironment detects common CI variables', () => {
  assert.equal(isCiEnvironment({ CI: 'true' }), true);
  assert.equal(isCiEnvironment({ GITHUB_ACTIONS: 'true' }), true);
  assert.equal(isCiEnvironment({ BUILD_BUILDID: '123' }), true);
  assert.equal(isCiEnvironment({ CI: 'false' }), false);
});

test('shouldUseInteractive honors explicit machine-readable and opt-out flags', () => {
  assert.equal(shouldUseInteractive({ json: true }), false);
  assert.equal(shouldUseInteractive({ plain: true }), false);
  assert.equal(shouldUseInteractive({ interactive: false }), false);
  assert.equal(withArgv(['--plain', 'search'], () => shouldUseInteractive()), false);
  assert.equal(withArgv(['--no-interactive', 'search'], () => shouldUseInteractive()), false);
});
