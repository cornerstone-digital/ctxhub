import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeArchitectureDrift } from './graph.js';

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
