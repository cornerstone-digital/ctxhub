import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { buildProvenanceBacklinks, buildReportGraphData, openReportCommand, reportCommand } from './report.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { readText } from '../utils/fs.js';
import { runGit } from '../git/git.js';
import { parseMempalaceStatus } from '../memory/mempalaceCli.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-report-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);

    const repoPath = path.join(cwd, 'app');
    await mkdir(repoPath, { recursive: true });
    await writeFile(path.join(repoPath, 'README.md'), '# App\n\n## Setup\n\nHow to set this up.\n');
    await writeFile(
      path.join(repoPath, 'architecture.mmd'),
      'flowchart LR\n  app --> db\n'
    );
    await runGit(['init'], repoPath);
    await runGit(['config', 'user.email', 'test@example.com'], repoPath);
    await runGit(['config', 'user.name', 'Test'], repoPath);
    await runGit(['add', '.'], repoPath);
    await runGit(['commit', '-m', 'init'], repoPath);

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: true });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    config.memory.provider = 'local-json';
    await saveConfig(config, cwd);

    process.chdir(cwd);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

async function captureLog(run: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.join(' '));
  };
  try {
    await run();
  } finally {
    console.log = original;
  }
  return lines;
}

test('reportCommand writes an HTML report with status, repos, architecture, and recent chunks', () => {
  return withWorkspace(async cwd => {
    await indexWorkspace(cwd);
    const output = path.join(cwd, 'report.html');
    const lines = await captureLog(() => reportCommand(
      { output, memoryQuery: 'graphql', memoryWing: 'app', memoryRoom: 'decisions', timelineEntity: 'graphql', timelineLimit: '10' },
      {
        readMempalaceSummary: async () => ({ available: true, totalDrawers: 3, note: '3 drawers across 2 room(s)', items: [{ section: 'memory', repo: 'app', path: 'decisions', title: 'app / decisions', snippet: '2 drawers in MemPalace', stale: false, count: 2 }] }),
        searchMempalaceFn: async () => ({ query: 'graphql', results: [{ wing: 'app', room: 'decisions', source_file: 'notes.md', text: 'GraphQL decision memory hit' }] }),
        timelineMempalaceFn: async () => ({ entity: 'graphql', count: 1, timeline: [{ subject: 'api', predicate: 'uses', object: 'graphql', valid_from: '2026-01-01' }] })
      }
    ));

    const html = await readText(output);
    assert.match(html, /<h1>ws<\/h1>/);
    assert.match(html, /app/);
    assert.match(html, /"section":"architecture"/);
    assert.match(html, /"section":"recent"/);
    assert.match(html, /"section":"memory"/);
    assert.match(html, /"section":"memory-hit"/);
    assert.match(html, /3 drawers across 2 room\(s\)/);
    assert.match(html, /GraphQL decision memory hit/);
    assert.match(html, /MemPalace timeline/);
    assert.match(html, /id="graph"/, 'should include the graph svg container');
    assert.match(html, /id="timeline-view"/, 'should include the timeline view');
    assert.match(html, /ctxhub-report-graph/, 'should include graph JSON payload');
    assert.match(html, /id="filter"/, 'should include the client-side filter input');
    assert.ok(lines.some(line => line.includes('Wrote report:')));
    assert.ok(lines.some(line => line.includes('architecture item')));
  });
});

test('reportCommand embeds in-page wing/room/timeline-entity controls and a re-run hint (NEXT_FEATURES #22)', () => {
  return withWorkspace(async cwd => {
    await indexWorkspace(cwd);
    const output = path.join(cwd, 'report.html');
    await captureLog(() => reportCommand(
      { output, memoryQuery: 'graphql', timelineEntity: 'graphql' },
      {
        readMempalaceSummary: async () => ({ available: true, items: [{ section: 'memory', repo: 'app', path: 'decisions', title: 'app / decisions', snippet: '2 drawers in MemPalace', stale: false, count: 2 }] }),
        searchMempalaceFn: async () => ({ query: 'graphql', results: [{ wing: 'app', room: 'decisions', source_file: 'notes.md', text: 'GraphQL decision memory hit' }] }),
        timelineMempalaceFn: async () => ({ entity: undefined, count: 1, timeline: [{ subject: 'api', predicate: 'uses', object: 'graphql', valid_from: '2026-01-01' }] })
      }
    ));

    const html = await readText(output);
    assert.match(html, /id="wing-filter"/);
    assert.match(html, /id="room-filter"/);
    assert.match(html, /id="timeline-entity-filter"/);
    assert.match(html, /regenerate with.*ctxhub report --memory-query/s);
    // The timeline payload should carry the distinct entities (from subject/object) and the
    // CLI-provided timelineEntity as a pre-select, for the in-page control to consume.
    assert.match(html, /"entities":\["api","graphql"\]/);
    assert.match(html, /"selectedEntity":"graphql"/);
  });
});

test('reportCommand always fetches the full/unfiltered MemPalace timeline, even when --timeline-entity is passed', () => {
  return withWorkspace(async cwd => {
    await indexWorkspace(cwd);
    const output = path.join(cwd, 'report.html');
    let requestedEntity: string | undefined = 'not-called';
    await captureLog(() => reportCommand(
      { output, timelineEntity: 'graphql' },
      {
        readMempalaceSummary: async () => ({ available: true, items: [] }),
        timelineMempalaceFn: async (_config, _workspaceRoot, input) => {
          requestedEntity = input.entity;
          return { count: 0, timeline: [] };
        }
      }
    ));

    // NEXT_FEATURES #22: entity selection is now an in-page control, not a generation-time gate --
    // the underlying MemPalace call should always request the broad, unfiltered timeline.
    assert.equal(requestedEntity, undefined);
  });
});

test('reportCommand escapes a literal </script> sequence inside embedded JSON so it cannot prematurely close the script tag', () => {
  return withWorkspace(async cwd => {
    await indexWorkspace(cwd);
    const output = path.join(cwd, 'report.html');
    await captureLog(() => reportCommand(
      { output, memoryQuery: 'graphql' },
      {
        readMempalaceSummary: async () => ({ available: true, items: [] }),
        // A memory hit whose text happens to contain a literal "</script>" -- e.g. a note
        // showing an HTML/JS snippet. Before the fix, this landed unescaped inside the
        // ctxhub-report-graph <script type="application/json"> block and would have prematurely
        // ended it as far as the HTML parser is concerned.
        searchMempalaceFn: async () => ({
          query: 'graphql',
          results: [{ wing: 'app', room: 'decisions', source_file: 'notes.md', text: 'example: </script><script>alert(1)</script>' }]
        }),
        timelineMempalaceFn: async () => ({ entity: undefined, count: 0, timeline: [] })
      }
    ));

    const html = await readText(output);
    // The raw, unescaped sequence must never appear between the graph script tag and its close --
    // every literal "</" from source data must have been turned into "<\/" first.
    const graphBlock = html.match(/<script id="ctxhub-report-graph"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
    assert.ok(!graphBlock.includes('</script>'), 'embedded JSON must not contain an unescaped </script> sequence');
    assert.match(graphBlock, /<\\\/script>/, 'the literal </script> from source data should be escaped to <\\/script>');
    // And it must still round-trip as valid JSON once the browser parses it.
    assert.doesNotThrow(() => JSON.parse(graphBlock.replaceAll('<\\/', '</')));
  });
});

test('buildReportGraphData links repos to files and architecture components', () => {
  const graph = buildReportGraphData(
    [{ name: 'app', path: './app' }],
    [
      {
        section: 'architecture',
        repo: 'app',
        path: 'architecture.mmd',
        title: 'Mermaid flowchart',
        snippet: 'app --> db',
        stale: false,
        components: ['app', 'db'],
        relationships: ['app --> db']
      },
      {
        section: 'memory',
        repo: 'app',
        path: 'decisions',
        title: 'app / decisions',
        snippet: '2 drawers in MemPalace',
        stale: false,
        count: 2
      },
      {
        section: 'memory-hit',
        repo: 'app',
        path: 'decisions',
        title: 'notes.md',
        snippet: 'GraphQL decision memory hit',
        stale: false
      }
    ]
  );

  assert.ok(graph.nodes.some(node => node.id === 'repo:app' && node.type === 'repo'));
  assert.ok(graph.nodes.some(node => node.id === 'file:app:architecture.mmd' && node.type === 'file'));
  assert.ok(graph.nodes.some(node => node.id === 'component:app' && node.type === 'component'));
  assert.ok(graph.nodes.some(node => node.id === 'memory-wing:app' && node.type === 'memory-wing'));
  assert.ok(graph.nodes.some(node => node.id === 'memory-room:app:decisions' && node.type === 'memory-room'));
  assert.ok(graph.nodes.some(node => node.id === 'memory-hit:app:decisions:notes.md' && node.type === 'memory-hit'));
  assert.ok(graph.edges.some(edge => edge.source === 'repo:app' && edge.target === 'file:app:architecture.mmd' && edge.type === 'contains'));
  assert.ok(graph.edges.some(edge => edge.source === 'file:app:architecture.mmd' && edge.target === 'component:db' && edge.type === 'documents'));
  assert.ok(graph.edges.some(edge => edge.source === 'component:app' && edge.target === 'component:db' && edge.type === 'depends-on'));
  assert.ok(graph.edges.some(edge => edge.source === 'memory-wing:app' && edge.target === 'memory-room:app:decisions' && edge.type === 'memory-contains'));
  assert.ok(graph.edges.some(edge => edge.source === 'memory-room:app:decisions' && edge.target === 'memory-hit:app:decisions:notes.md' && edge.type === 'memory-match'));
});

test('buildProvenanceBacklinks links a memory hit to the exact repo:path file it names', () => {
  const edges = buildProvenanceBacklinks([
    { section: 'recent', repo: 'app', path: 'auth.ts', title: 'auth.ts', snippet: '', stale: false },
    { section: 'memory-hit', repo: 'app', path: 'decisions', title: 'notes.md', snippet: '', stale: false, sourceFile: 'auth.ts' }
  ]);

  assert.deepEqual(edges, [{ source: 'memory-hit:app:decisions:notes.md', target: 'file:app:auth.ts', type: 'documented-by' }]);
});

test('buildProvenanceBacklinks falls back to a path-only match when the memory wing does not match the file\'s repo', () => {
  // MemPalace's "wing" (here: "auth-project") is a free-text label, not guaranteed to equal a
  // configured repo name ("app") -- this is exactly the mismatch #23 has to tolerate.
  const edges = buildProvenanceBacklinks([
    { section: 'recent', repo: 'app', path: 'auth.ts', title: 'auth.ts', snippet: '', stale: false },
    { section: 'memory-hit', repo: 'auth-project', path: 'decisions', title: 'notes.md', snippet: '', stale: false, sourceFile: 'auth.ts' }
  ]);

  assert.deepEqual(edges, [{ source: 'memory-hit:auth-project:decisions:notes.md', target: 'file:app:auth.ts', type: 'documented-by' }]);
});

test('buildProvenanceBacklinks produces no edge when a memory hit names no source file or nothing matches', () => {
  const noSourceFile = buildProvenanceBacklinks([
    { section: 'recent', repo: 'app', path: 'auth.ts', title: 'auth.ts', snippet: '', stale: false },
    { section: 'memory-hit', repo: 'app', path: 'decisions', title: 'notes.md', snippet: '', stale: false }
  ]);
  assert.deepEqual(noSourceFile, []);

  const noMatch = buildProvenanceBacklinks([
    { section: 'recent', repo: 'app', path: 'auth.ts', title: 'auth.ts', snippet: '', stale: false },
    { section: 'memory-hit', repo: 'app', path: 'decisions', title: 'notes.md', snippet: '', stale: false, sourceFile: 'unrelated.ts' }
  ]);
  assert.deepEqual(noMatch, []);
});

test('buildReportGraphData includes provenance backlink edges and carries sourceFile/timestamp onto memory-hit nodes', () => {
  const graph = buildReportGraphData(
    [{ name: 'app', path: './app' }],
    [
      { section: 'recent', repo: 'app', path: 'auth.ts', title: 'auth.ts', snippet: 'auth code', stale: false },
      {
        section: 'memory-hit',
        repo: 'app',
        path: 'decisions',
        title: 'notes.md',
        snippet: 'GraphQL decision memory hit',
        stale: false,
        sourceFile: 'auth.ts',
        timestamp: '2026-01-01T00:00:00.000Z'
      }
    ]
  );

  const hitNode = graph.nodes.find(node => node.id === 'memory-hit:app:decisions:notes.md');
  assert.equal(hitNode?.sourceFile, 'auth.ts');
  assert.equal(hitNode?.timestamp, '2026-01-01T00:00:00.000Z');
  assert.ok(
    graph.edges.some(edge => edge.source === 'memory-hit:app:decisions:notes.md' && edge.target === 'file:app:auth.ts' && edge.type === 'documented-by')
  );
});

test('parseMempalaceStatus extracts wing and room counts into report items', () => {
  const parsed = parseMempalaceStatus([
    '=======================================================',
    '  MemPalace Status — 7 drawers',
    '=======================================================',
    '',
    '  WING: app',
    '    ROOM: decisions                2 drawers',
    '    ROOM: auth                     5 drawers',
    ''
  ].join('\n'));

  assert.equal(parsed.totalDrawers, 7);
  assert.deepEqual(parsed.items.map(item => [item.wing, item.room, item.count]), [
    ['app', 'decisions', 2],
    ['app', 'auth', 5]
  ]);
});

test('openReportCommand picks the platform launcher without shell interpolation', () => {
  assert.deepEqual(openReportCommand('/tmp/report.html', 'darwin'), { command: 'open', args: ['/tmp/report.html'] });
  assert.deepEqual(openReportCommand('/tmp/report.html', 'win32'), { command: 'cmd', args: ['/c', 'start', '', '/tmp/report.html'] });
  assert.deepEqual(openReportCommand('/tmp/report.html', 'linux'), { command: 'xdg-open', args: ['/tmp/report.html'] });
});

test('reportCommand flags stale chunks when the repo has drifted from the indexed commit', () => {
  return withWorkspace(async cwd => {
    await indexWorkspace(cwd);
    await writeFile(path.join(cwd, 'app', 'README.md'), '# App\n\nchanged after indexing\n');

    const output = path.join(cwd, 'report.html');
    await reportCommand({ output });

    const html = await readText(output);
    assert.match(html, /"stale":true/);
    assert.match(html, /Stale results found: [1-9]/);
  });
});

test('reportCommand does not create or migrate a missing LanceDB table', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.index.provider = 'lancedb';
    config.index.path = '.ctxhub/index/lancedb';
    config.index.table = 'ctxhub_chunks';
    await saveConfig(config, cwd);

    const output = path.join(cwd, 'report.html');
    await reportCommand({ output });

    const html = await readText(output);
    assert.match(html, /Chunks: 0/);

    const lancedb = await import('@lancedb/lancedb');
    const db = await lancedb.connect(path.join(cwd, '.ctxhub/index/lancedb'));
    assert.deepEqual(await db.tableNames(), []);
  });
});
