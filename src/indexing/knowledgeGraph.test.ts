import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { indexWorkspace } from './indexer.js';
import { buildKnowledgeGraph } from './knowledgeGraph.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-kg-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);

    const repoPath = path.join(cwd, 'app');
    await mkdir(path.join(repoPath, 'docs', 'architecture'), { recursive: true });
    await writeFile(
      path.join(repoPath, 'billing.md'),
      '# Billing\n\nHandles invoices and payment processing for customers.\n'
    );
    await writeFile(
      path.join(repoPath, 'invoices.md'),
      '# Invoices\n\nGenerates customer invoices and tracks payment processing status.\n'
    );
    await writeFile(
      path.join(repoPath, 'docs', 'architecture', 'system.mmd'),
      ['flowchart TD', '  API[API] --> Worker[Worker]', '  Worker --> DB[(Postgres)]'].join('\n')
    );

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, cwd);

    process.chdir(cwd);
    await indexWorkspace(cwd, false);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

test('buildKnowledgeGraph produces one node per indexed file plus component nodes from diagrams', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const graph = await buildKnowledgeGraph(config, cwd);

    const fileNodes = graph.nodes.filter(n => n.kind === 'file');
    const componentNodes = graph.nodes.filter(n => n.kind === 'component');

    assert.ok(fileNodes.some(n => n.id.endsWith('billing.md')));
    assert.ok(fileNodes.some(n => n.id.endsWith('invoices.md')));
    assert.ok(componentNodes.some(n => n.id === 'API'));
    assert.ok(componentNodes.some(n => n.id === 'Worker'));
    assert.ok(componentNodes.some(n => n.id === 'DB'));
    assert.equal(graph.truncated, false);
  });
});

test('buildKnowledgeGraph links diagram components with real edges parsed from relationship lines', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const graph = await buildKnowledgeGraph(config, cwd);

    const diagramEdges = graph.edges.filter(e => e.kind === 'diagram');
    assert.ok(diagramEdges.some(e => e.source === 'API' && e.target === 'Worker'));
    assert.ok(diagramEdges.some(e => e.source === 'Worker' && e.target === 'DB'));
  });
});

test('buildKnowledgeGraph finds a similarity edge between two files with related content', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const graph = await buildKnowledgeGraph(config, cwd);

    const billing = graph.nodes.find(n => n.id.endsWith('billing.md'));
    const invoices = graph.nodes.find(n => n.id.endsWith('invoices.md'));
    assert.ok(billing);
    assert.ok(invoices);

    const linked = graph.edges.some(
      e =>
        e.kind === 'similarity' &&
        ((e.source === billing!.id && e.target === invoices!.id) || (e.source === invoices!.id && e.target === billing!.id))
    );
    assert.ok(linked, 'expected a similarity edge between billing.md and invoices.md');
  });
});

test('buildKnowledgeGraph sets connections to each node\'s real edge count', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const graph = await buildKnowledgeGraph(config, cwd);

    for (const node of graph.nodes) {
      const expected = graph.edges.filter(e => e.source === node.id || e.target === node.id).length;
      assert.equal(node.connections, expected, `connections mismatch for ${node.id}`);
    }
  });
});
