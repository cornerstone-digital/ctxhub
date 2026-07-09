import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateMermaidSyntax } from './validate.js';

test('validateMermaidSyntax accepts a valid flowchart', () => {
  const issues = validateMermaidSyntax(`flowchart TD
Api[API] --> Worker[Worker]
Worker --> Db[(Database)]
`);

  assert.deepEqual(issues, []);
});

test('validateMermaidSyntax reports unbalanced delimiters', () => {
  const issues = validateMermaidSyntax(`flowchart TD
Api[API --> Worker
`);

  assert.ok(issues.some(issue => issue.message.includes('unmatched opening delimiter "["')));
});

test('validateMermaidSyntax reports malformed flowchart relationships', () => {
  const issues = validateMermaidSyntax(`flowchart TD
Api -->
`);

  assert.ok(issues.some(issue => issue.message.includes('malformed flowchart relationship')));
});

test('validateMermaidSyntax reports malformed sequence relationships', () => {
  const issues = validateMermaidSyntax(`sequenceDiagram
Api ->> : missing target
`);

  assert.ok(issues.some(issue => issue.message.includes('malformed sequence relationship')));
});

test('validateMermaidSyntax requires a first-line declaration in strict mode', () => {
  const issues = validateMermaidSyntax('Api --> Worker');

  assert.ok(issues.some(issue => issue.message.includes('first-line declaration')));
});
