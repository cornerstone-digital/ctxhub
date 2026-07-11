import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile, unlink } from 'node:fs/promises';
import { indexWorkspace } from './indexer.js';
import { buildKnowledgeGraph, findKnowledgeGraphNodeContent, expandKnowledgeGraphNode } from './knowledgeGraph.js';
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

test('buildKnowledgeGraph renders every file as a node even past the similarity-edge budget (Obsidian-style: no display cap)', () => {
  const cwd = mkdtemp(path.join(os.tmpdir(), 'ctxhub-kg-many-'));
  return cwd.then(async dir => {
    const originalCwd = process.cwd();
    try {
      await initConfig('ws', dir);
      const repoPath = path.join(dir, 'app');
      await mkdir(repoPath, { recursive: true });

      const FILE_COUNT = 130; // one past MAX_SIMILARITY_NODES (120)
      for (let i = 0; i < FILE_COUNT; i++) {
        await writeFile(path.join(repoPath, `note-${i}.md`), `# Note ${i}\n\nContent for note ${i}.\n`);
      }

      const config = await loadConfig(dir);
      config.repositories.push({ name: 'app', path: './app', git: false });
      config.index.provider = 'local-json';
      config.index.path = '.ctxhub/index/local.json';
      await saveConfig(config, dir);

      process.chdir(dir);
      await indexWorkspace(dir, false);

      const graph = await buildKnowledgeGraph(config, dir);
      const fileNodes = graph.nodes.filter(n => n.kind === 'file');

      // Every indexed file becomes a node -- unlike the old MAX_FILE_NODES cap, node count is not
      // limited to the similarity-edge budget.
      assert.equal(fileNodes.length, FILE_COUNT);
      // But the budget still bounds the expensive part (one real index search per file for
      // similarity edges), so `truncated` now reports edge coverage, not missing nodes.
      assert.equal(graph.truncated, true);
    } finally {
      process.chdir(originalCwd);
      await rm(dir, { recursive: true, force: true });
    }
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

test('expandKnowledgeGraphNode finds the same similarity edge on demand, for a single node, without a full graph rebuild', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const graph = await buildKnowledgeGraph(config, cwd);
    const invoices = graph.nodes.find(n => n.id.endsWith('invoices.md'));
    assert.ok(invoices);

    // The bulk build's edge above is found via lexical search from invoices.md's content
    // (asymmetric like lexical search generally is -- billing.md's content doesn't rank
    // invoices.md highly enough as a query, but invoices.md's content does rank billing.md), so
    // expand from the same direction here for a real, non-flaky assertion.
    const edges = await expandKnowledgeGraphNode(config, cwd, invoices!.id);
    assert.ok(edges);
    assert.ok(
      edges!.some(e => e.source === invoices!.id && e.target.endsWith('billing.md')),
      'expected expandKnowledgeGraphNode to find billing.md as a similarity neighbor of invoices.md'
    );
  });
});

test('expandKnowledgeGraphNode returns undefined for a node id that matches no indexed file', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const edges = await expandKnowledgeGraphNode(config, cwd, 'app:nonexistent.md');
    assert.equal(edges, undefined);
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

test('findKnowledgeGraphNodeContent returns the indexed content for a file node, keyed the same way buildKnowledgeGraph ids it', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const graph = await buildKnowledgeGraph(config, cwd);
    const billing = graph.nodes.find(n => n.id.endsWith('billing.md'));
    assert.ok(billing);

    const content = await findKnowledgeGraphNodeContent(config, cwd, billing!.id);
    assert.ok(content);
    assert.equal(content!.kind, 'file');
    if (content!.kind === 'file') {
      assert.equal(content!.repo, 'app');
      assert.equal(content!.filePath, 'billing.md');
      assert.match(content!.content, /payment processing/);
      // The real current file, not just whatever chunk the index happened to store.
      assert.equal(content!.contentSource, 'disk');
      assert.equal(content!.truncated, false);
    }
  });
});

test('findKnowledgeGraphNodeContent redacts file content the same way indexing would', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.privacy.redactPatterns.push('payment processing');
    const content = await findKnowledgeGraphNodeContent(config, cwd, 'app:billing.md');
    assert.ok(content);
    if (content!.kind === 'file') {
      assert.doesNotMatch(content!.content, /payment processing/);
      assert.match(content!.content, /\[REDACTED\]/);
    }
  });
});

test('findKnowledgeGraphNodeContent falls back to the indexed content if the file was deleted since indexing', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    await unlink(path.join(cwd, 'app', 'billing.md'));

    const content = await findKnowledgeGraphNodeContent(config, cwd, 'app:billing.md');
    assert.ok(content);
    if (content!.kind === 'file') {
      assert.equal(content!.contentSource, 'index');
      assert.match(content!.content, /payment processing/);
    }
  });
});

test('findKnowledgeGraphNodeContent returns the source diagram(s) for a component node', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const content = await findKnowledgeGraphNodeContent(config, cwd, 'Worker');
    assert.ok(content);
    assert.equal(content!.kind, 'component');
    if (content!.kind === 'component') {
      assert.equal(content!.diagrams.length, 1);
      assert.match(content!.diagrams[0].content, /Worker/);
    }
  });
});

test('findKnowledgeGraphNodeContent returns undefined for an id that matches nothing indexed', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    const content = await findKnowledgeGraphNodeContent(config, cwd, 'app:does-not-exist.md');
    assert.equal(content, undefined);
  });
});
