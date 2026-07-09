import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactContent } from './redact.js';

test('redactContent replaces configured secret patterns case-insensitively', () => {
  const result = redactContent('API_KEY=abc123\npassword: letmein\nkeep=this', [
    '(api[_-]?key|token|secret|password)\\s*[:=]\\s*[^\\s]+'
  ]);

  assert.equal(result.redacted, true);
  assert.equal(result.content, '[REDACTED]\n[REDACTED]\nkeep=this');
});

test('redactContent ignores invalid user patterns', () => {
  const result = redactContent('secret=value', ['[']);

  assert.equal(result.redacted, false);
  assert.equal(result.content, 'secret=value');
});
