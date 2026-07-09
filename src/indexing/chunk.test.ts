import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chunkDocument,
  chunkMarkdown,
  chunkPlainText,
  detectDiagramType,
  extractDiagramComponents,
  extractDiagramRelationships,
  extractTitle
} from './chunk.js';

test('extractTitle finds the first H1', () => {
  assert.equal(extractTitle('# Hello World\n\nBody text.'), 'Hello World');
  assert.equal(extractTitle('No heading here.'), undefined);
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

test('diagram helpers detect type, components, and relationships', () => {
  const content = 'flowchart LR\n  Web --> API\n  API --> DB';
  assert.equal(detectDiagramType(content), 'flowchart');
  assert.deepEqual(extractDiagramComponents(content), ['Web', 'API', 'DB']);
  assert.deepEqual(extractDiagramRelationships(content), ['Web --> API', 'API --> DB']);
});
