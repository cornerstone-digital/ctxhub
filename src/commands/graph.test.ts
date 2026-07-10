import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeArchitectureDrift, suggestDriftRepairs, type DriftFinding } from './graph.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig, SearchResult } from '../config/types.js';

test('analyzeArchitectureDrift accepts repo and package aliases as known components', () => {
  const findings = analyzeArchitectureDrift({
    repos: [
      { name: 'api-service', path: './api' },
      { name: 'web', path: './web' }
    ],
    components: ['api-service', 'web'],
    relationships: ['api-service --> web'],
    diagrams: [{ repo: 'api-service', path: 'docs/architecture/runtime.mmd', type: 'flowchart' }],
    packages: [
      { repo: 'api-service', package: '@acme/api-service', dependencies: [] },
      { repo: 'web', package: '@acme/web', dependencies: [] }
    ]
  });

  assert.deepEqual(findings, []);
});

test('analyzeArchitectureDrift flags unknown components and relationship endpoints', () => {
  const findings = analyzeArchitectureDrift({
    repos: [{ name: 'api', path: './api' }],
    components: ['api', 'Billing'],
    relationships: ['api --> Billing'],
    diagrams: [{ repo: 'api', path: 'docs/architecture/runtime.mmd', type: 'flowchart' }],
    packages: [{ repo: 'api', package: '@acme/api', dependencies: [] }]
  });

  assert.ok(findings.some(finding => finding.type === 'unknown-component' && finding.component === 'Billing'));
  assert.ok(findings.some(finding => finding.type === 'unknown-relationship-endpoint' && finding.component === 'Billing'));
});

test('analyzeArchitectureDrift flags repos with no representation or owned diagram', () => {
  const findings = analyzeArchitectureDrift({
    repos: [
      { name: 'api', path: './api' },
      { name: 'worker', path: './worker' }
    ],
    components: ['api'],
    relationships: [],
    diagrams: [{ repo: 'api', path: 'docs/architecture/runtime.mmd', type: 'flowchart' }],
    packages: []
  });

  assert.ok(findings.some(finding => finding.type === 'unrepresented-repo' && finding.repo === 'worker'));
});

function config(overrides: Partial<CtxhubConfig['llm']> = {}): CtxhubConfig {
  return { ...defaultConfig, llm: { ...defaultConfig.llm, ...overrides } };
}

function diagram(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: 'diagram-1',
    workspace: 'ws',
    repo: 'api',
    filePath: 'docs/architecture/runtime.mmd',
    absolutePath: '/tmp/api/docs/architecture/runtime.mmd',
    kind: 'architecture-diagram',
    components: ['Billing'],
    relationships: ['api --> Billing'],
    content: 'architecture diagram mermaid\nflowchart LR\n  api --> Billing',
    hash: 'hash',
    lastIndexed: '2026-07-10T00:00:00.000Z',
    score: 1,
    snippet: 'flowchart LR api --> Billing',
    ...overrides
  };
}

const unknownComponentFinding: DriftFinding = {
  severity: 'warning',
  type: 'unknown-component',
  component: 'Billing',
  message: 'Unknown architecture component "Billing" does not match a configured repo or package name.'
};

test('suggestDriftRepairs returns nothing and never calls the LLM when there are no repairable findings', async () => {
  let called = false;
  const result = await suggestDriftRepairs(
    [diagram()],
    [{ severity: 'warning', type: 'unrepresented-repo', repo: 'worker', message: 'no diagram' }],
    config({ enabled: true }),
    async () => {
      called = true;
      return { ok: true, text: 'flowchart LR' };
    }
  );
  assert.deepEqual(result.suggestions, []);
  assert.equal(called, false);
});

test('suggestDriftRepairs reports the disabled notice without attempting a repair when llm.enabled is false', async () => {
  const result = await suggestDriftRepairs([diagram()], [unknownComponentFinding], config({ enabled: false }));
  assert.deepEqual(result.suggestions, []);
  assert.match(result.llmNotice ?? '', /llm\.enabled: true/);
});

test('suggestDriftRepairs diffs the real file content against the proposed fix', async () => {
  const readFileFn = async () => 'flowchart LR\n  api --> Billing\n';
  const result = await suggestDriftRepairs(
    [diagram()],
    [unknownComponentFinding],
    config({ enabled: true }),
    async () => ({ ok: true, text: 'flowchart LR\n  api --> billing-service\n' }),
    readFileFn
  );

  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0].repo, 'api');
  assert.equal(result.suggestions[0].path, 'docs/architecture/runtime.mmd');
  assert.match(result.suggestions[0].diff, /-\s+api --> Billing/);
  assert.match(result.suggestions[0].diff, /\+\s+api --> billing-service/);
});

test('suggestDriftRepairs skips a finding with no matching diagram instead of throwing', async () => {
  const result = await suggestDriftRepairs(
    [diagram({ components: ['SomethingElse'], relationships: [] })],
    [unknownComponentFinding],
    config({ enabled: true }),
    async () => ({ ok: true, text: 'irrelevant' })
  );
  assert.deepEqual(result.suggestions, []);
});

test('suggestDriftRepairs skips a finding whose LLM call fails, without dropping the rest of the run', async () => {
  const result = await suggestDriftRepairs(
    [diagram()],
    [unknownComponentFinding],
    config({ enabled: true }),
    async () => ({ ok: false, reason: 'timeout' })
  );
  assert.deepEqual(result.suggestions, []);
});
