import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFileSummaryChunk,
  buildFileSummaryChunkWithLlm,
  chunkDocument,
  chunkMarkdown,
  chunkPlainText,
  chunkSourceCode,
  detectDiagramType,
  extractDiagramComponents,
  extractDiagramRelationships,
  extractTitle,
  meetsMinTrustTier,
  TRUST_TIER_ORDER,
  type ChunkTrustTier
} from './chunk.js';
import { defaultConfig } from '../config/defaultConfig.js';

test('extractTitle finds the first H1', () => {
  assert.equal(extractTitle('# Hello World\n\nBody text.'), 'Hello World');
  assert.equal(extractTitle('No heading here.'), undefined);
});

test('buildFileSummaryChunk lists every sub-chunk heading for a multi-section markdown file', () => {
  const parts = chunkMarkdown('# Guide\n\n## Install\n\ntext\n\n## Usage\n\ntext', 1800);
  const summary = buildFileSummaryChunk('docs/guide.md', 'Guide', parts);
  assert.equal(summary?.kind, 'file-summary');
  assert.match(summary?.content ?? '', /Install/);
  assert.match(summary?.content ?? '', /Usage/);
});

test('buildFileSummaryChunk lists symbol names for a multi-function source file (same heading field, no special-casing)', () => {
  const parts = chunkSourceCode('function alpha() {}\n\nfunction beta() {}\n', 1800);
  const summary = buildFileSummaryChunk('src/thing.ts', undefined, parts);
  assert.match(summary?.content ?? '', /alpha/);
  assert.match(summary?.content ?? '', /beta/);
});

test('buildFileSummaryChunk returns undefined for a single-chunk file -- no summary needed when the file is already compact', () => {
  const parts = chunkPlainText('just one short paragraph', 1800);
  assert.equal(parts.length, 1);
  assert.equal(buildFileSummaryChunk('README.md', undefined, parts), undefined);
});

test('buildFileSummaryChunk returns undefined when no sub-chunk has a heading to summarize', () => {
  const parts = chunkPlainText('paragraph one\n\n' + 'x'.repeat(2000), 1800);
  assert.ok(parts.length > 1);
  assert.equal(buildFileSummaryChunk('notes.txt', undefined, parts), undefined);
});

test('buildFileSummaryChunkWithLlm falls back to the non-LLM summary when llm.enabled is false', async () => {
  const content = '# Guide\n\n## Install\n\n' + 'x'.repeat(2500) + '\n\n## Usage\n\n' + 'y'.repeat(2500);
  const parts = chunkMarkdown(content, 1800);
  const summary = await buildFileSummaryChunkWithLlm('docs/guide.md', 'Guide', parts, content, defaultConfig);
  assert.match(summary?.content ?? '', /Contains: Guide, Install, Usage/);
});

test('buildFileSummaryChunkWithLlm uses the synthesized prose summary for large files when the LLM call succeeds', async () => {
  const content = '# Guide\n\n## Install\n\n' + 'x'.repeat(2500) + '\n\n## Usage\n\n' + 'y'.repeat(2500);
  const parts = chunkMarkdown(content, 1800);
  const summary = await buildFileSummaryChunkWithLlm(
    'docs/guide.md',
    'Guide',
    parts,
    content,
    { ...defaultConfig, llm: { ...defaultConfig.llm, enabled: true } },
    async () => ({ ok: true, text: 'This guide covers install and usage for the app.' })
  );
  assert.match(summary?.content ?? '', /This guide covers install and usage for the app\./);
  assert.doesNotMatch(summary?.content ?? '', /Contains:/);
});

test('buildFileSummaryChunkWithLlm falls back when the LLM call fails', async () => {
  const content = '# Guide\n\n## Install\n\n' + 'x'.repeat(2500) + '\n\n## Usage\n\n' + 'y'.repeat(2500);
  const parts = chunkMarkdown(content, 1800);
  const summary = await buildFileSummaryChunkWithLlm(
    'docs/guide.md',
    'Guide',
    parts,
    content,
    { ...defaultConfig, llm: { ...defaultConfig.llm, enabled: true } },
    async () => ({ ok: false, reason: 'timeout' })
  );
  assert.match(summary?.content ?? '', /Contains: Guide, Install, Usage/);
});

test('chunkMarkdown splits on headings and keeps heading metadata', () => {
  const content = [
    '# App',
    '',
    'Intro text.',
    '',
    '## Authentication flow',
    '',
    'Auth details.'
  ].join('\n');

  const chunks = chunkMarkdown(content, 1800);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].heading, 'App');
  assert.match(chunks[0].content, /Intro text\./);
  assert.equal(chunks[1].heading, 'Authentication flow');
  assert.match(chunks[1].content, /Auth details\./);
});

test('chunkMarkdown preserves frontmatter in the first section', () => {
  const content = '---\ntitle: Doc\n---\n# Heading\n\nBody.';
  const chunks = chunkMarkdown(content, 1800);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0].content, /^---\ntitle: Doc\n---/);
});

test('chunkPlainText splits paragraphs once maxChars is exceeded', () => {
  const paragraph = 'x'.repeat(50);
  const content = [paragraph, paragraph, paragraph].join('\n\n');
  const chunks = chunkPlainText(content, 60);
  assert.equal(chunks.length, 3);
  for (const chunk of chunks) assert.ok(chunk.content.length <= 60);
});

test('chunkMarkdown falls back to plain-text chunking with no headings', () => {
  const content = 'Just a paragraph with no markdown heading at all.';
  const chunks = chunkMarkdown(content, 1800);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].heading, undefined);
  assert.equal(chunks[0].content, content);
});

test('chunkDocument indexes Mermaid files as architecture diagrams with graph metadata', () => {
  const content = [
    'flowchart TD',
    '  API[API] --> Worker[Worker]',
    '  Worker --> DB[(Postgres)]'
  ].join('\n');
  const [chunk] = chunkDocument('docs/architecture/system.mmd', content, 1800);

  assert.equal(chunk.kind, 'architecture-diagram');
  assert.equal(chunk.diagramType, 'flowchart');
  assert.deepEqual(chunk.components, ['API', 'Worker', 'DB']);
  assert.deepEqual(chunk.relationships, ['API[API] --> Worker[Worker]', 'Worker --> DB[(Postgres)]']);
});

test('chunkDocument extracts Mermaid fenced blocks from Markdown as diagram chunks', () => {
  const content = [
    '# System',
    '',
    'Overview.',
    '',
    '```mermaid',
    'sequenceDiagram',
    '  API->>Worker: enqueue',
    '```'
  ].join('\n');
  const chunks = chunkDocument('docs/system.md', content, 1800);

  assert.equal(chunks.length, 2);
  assert.equal(chunks[1].kind, 'architecture-diagram');
  assert.equal(chunks[1].diagramType, 'sequenceDiagram');
});

test('chunkSourceCode produces one chunk per top-level function, tagged with its symbol name', () => {
  const content = [
    'import path from "node:path";',
    '',
    'export function first() {',
    '  return 1;',
    '}',
    '',
    'export function second() {',
    '  return 2;',
    '}'
  ].join('\n');

  const chunks = chunkSourceCode(content, 1800);
  const named = chunks.filter(c => c.symbol);
  assert.deepEqual(named.map(c => c.symbol), ['first', 'second']);
  assert.ok(named[0].content.includes('return 1;'));
  assert.ok(named[1].content.includes('return 2;'));
  assert.equal(named[0].symbolKind, 'function');
});

test('chunkSourceCode keeps a chunk with module-level code that sits outside any function', () => {
  const content = [
    'export const CONFIG_PATH = "ctxhub.yaml";',
    '',
    'export function load() {',
    '  return CONFIG_PATH;',
    '}'
  ].join('\n');

  const chunks = chunkSourceCode(content, 1800);
  assert.ok(chunks.some(c => !c.symbol && c.content.includes('CONFIG_PATH = "ctxhub.yaml"')));
  assert.ok(chunks.some(c => c.symbol === 'load'));
});

test('chunkSourceCode returns nothing when no recognizable symbols are found, so chunkDocument falls back to plain text', () => {
  const content = 'export const A = 1;\nexport const B = 2;\n';
  assert.deepEqual(chunkSourceCode(content, 1800), []);

  const [chunk] = chunkDocument('src/constants.ts', content, 1800);
  assert.equal(chunk.symbol, undefined);
  assert.match(chunk.content, /A = 1/);
});

test('chunkDocument routes .ts files through symbol-aware chunking', () => {
  const content = [
    'export function greet(name: string) {',
    '  return `hi ${name}`;',
    '}'
  ].join('\n');

  const [chunk] = chunkDocument('src/greet.ts', content, 1800);
  assert.equal(chunk.symbol, 'greet');
  assert.equal(chunk.symbolKind, 'function');
  assert.equal(chunk.heading, 'greet');
});

test('diagram helpers detect type, components, and relationships', () => {
  const content = 'flowchart LR\n  Web --> API\n  API --> DB';
  assert.equal(detectDiagramType(content), 'flowchart');
  assert.deepEqual(extractDiagramComponents(content), ['Web', 'API', 'DB']);
  assert.deepEqual(extractDiagramRelationships(content), ['Web --> API', 'API --> DB']);
});

// ── TRUST_TIER_ORDER ──────────────────────────────────────────────────────────

describe('TRUST_TIER_ORDER', () => {
  test('contains all five tiers in the correct named order', () => {
    const expected: ChunkTrustTier[] = ['unverified', 'reviewed', 'promoted', 'institutional', 'canonical'];
    assert.deepEqual(TRUST_TIER_ORDER, expected);
  });

  test('is strictly ascending — each entry has a higher index than the one before it', () => {
    for (let i = 0; i < TRUST_TIER_ORDER.length - 1; i++) {
      const lower = TRUST_TIER_ORDER[i];
      const higher = TRUST_TIER_ORDER[i + 1];
      assert.ok(
        TRUST_TIER_ORDER.indexOf(lower) < TRUST_TIER_ORDER.indexOf(higher),
        `Expected ${lower} (index ${i}) < ${higher} (index ${i + 1})`
      );
    }
  });

  test('has no duplicate entries', () => {
    const unique = new Set(TRUST_TIER_ORDER);
    assert.equal(unique.size, TRUST_TIER_ORDER.length, 'TRUST_TIER_ORDER should have no duplicates');
  });
});

// ── meetsMinTrustTier ─────────────────────────────────────────────────────────

describe('meetsMinTrustTier', () => {
  test('unverified meets min unverified', () => {
    assert.equal(meetsMinTrustTier({ trustTier: 'unverified' }, 'unverified'), true);
  });

  test('unverified does not meet min reviewed', () => {
    assert.equal(meetsMinTrustTier({ trustTier: 'unverified' }, 'reviewed'), false);
  });

  test('reviewed meets min reviewed', () => {
    assert.equal(meetsMinTrustTier({ trustTier: 'reviewed' }, 'reviewed'), true);
  });

  test('reviewed meets min unverified (higher tier satisfies lower minimum)', () => {
    assert.equal(meetsMinTrustTier({ trustTier: 'reviewed' }, 'unverified'), true);
  });

  test('promoted meets min promoted', () => {
    assert.equal(meetsMinTrustTier({ trustTier: 'promoted' }, 'promoted'), true);
  });

  test('promoted does not meet min institutional', () => {
    assert.equal(meetsMinTrustTier({ trustTier: 'promoted' }, 'institutional'), false);
  });

  test('institutional meets min institutional', () => {
    assert.equal(meetsMinTrustTier({ trustTier: 'institutional' }, 'institutional'), true);
  });

  test('institutional does not meet min canonical', () => {
    assert.equal(meetsMinTrustTier({ trustTier: 'institutional' }, 'canonical'), false);
  });

  test('canonical meets every tier (highest tier satisfies all minimums)', () => {
    for (const tier of TRUST_TIER_ORDER) {
      assert.equal(
        meetsMinTrustTier({ trustTier: 'canonical' }, tier),
        true,
        `canonical should meet min ${tier}`
      );
    }
  });

  test('undefined trustTier treated as unverified — meets min unverified', () => {
    assert.equal(meetsMinTrustTier({}, 'unverified'), true);
  });

  test('undefined trustTier treated as unverified — does not meet min reviewed', () => {
    assert.equal(meetsMinTrustTier({}, 'reviewed'), false);
  });

  test('undefined trustTier treated as unverified — does not meet min institutional', () => {
    assert.equal(meetsMinTrustTier({}, 'institutional'), false);
  });

  test('each tier meets its own minimum (identity)', () => {
    for (const tier of TRUST_TIER_ORDER) {
      assert.equal(
        meetsMinTrustTier({ trustTier: tier }, tier),
        true,
        `${tier} should meet min ${tier}`
      );
    }
  });
});
