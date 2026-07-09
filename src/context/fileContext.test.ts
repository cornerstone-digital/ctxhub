import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { getFileContext } from './fileContext.js';
import { initConfig, loadConfig } from '../config/config.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-filecontext-'));
  try {
    await initConfig('ws', cwd);
    await mkdir(path.join(cwd, 'app', 'src'), { recursive: true });
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

const SOURCE = [
  /* 1 */ 'export function outer() {',
  /* 2 */ '  return inner();',
  /* 3 */ '',
  /* 4 */ '  function inner() {',
  /* 5 */ '    return 1;',
  /* 6 */ '  }',
  /* 7 */ '}',
  /* 8 */ '',
  /* 9 */ '# not a real comment, just plain text after the function'
].join('\n');

test('getFileContext defaults to returning the full enclosing function for source files', () => {
  return withWorkspace(async cwd => {
    await writeFile(path.join(cwd, 'app', 'src', 'thing.ts'), SOURCE);
    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });

    const result = await getFileContext(config, 'app', 'src/thing.ts', { line: 5 }, cwd);
    assert.equal(result.symbol?.name, 'inner');
    assert.equal(result.startLine, 4);
    assert.equal(result.endLine, 6);
  });
});

test('getFileContext mode "lines" ignores symbol detection even for source files', () => {
  return withWorkspace(async cwd => {
    await writeFile(path.join(cwd, 'app', 'src', 'thing.ts'), SOURCE);
    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });

    const result = await getFileContext(config, 'app', 'src/thing.ts', { line: 5, mode: 'lines', before: 1, after: 1 }, cwd);
    assert.equal(result.symbol, undefined);
    assert.equal(result.startLine, 4);
    assert.equal(result.endLine, 6);
  });
});

test('getFileContext falls back to line-window behavior for non-source files', () => {
  return withWorkspace(async cwd => {
    const content = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
    await writeFile(path.join(cwd, 'app', 'README.md'), content);
    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });

    const result = await getFileContext(config, 'app', 'README.md', { line: 5, before: 1, after: 1 }, cwd);
    assert.equal(result.symbol, undefined);
    assert.equal(result.startLine, 4);
    assert.equal(result.endLine, 6);
  });
});

test('getFileContext falls back to line-window behavior when no enclosing symbol is found in a source file', () => {
  return withWorkspace(async cwd => {
    await writeFile(path.join(cwd, 'app', 'src', 'constants.ts'), 'export const A = 1;\nexport const B = 2;\nexport const C = 3;\n');
    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });

    const result = await getFileContext(config, 'app', 'src/constants.ts', { line: 2, before: 1, after: 1 }, cwd);
    assert.equal(result.symbol, undefined);
    assert.equal(result.startLine, 1);
    assert.equal(result.endLine, 3);
  });
});
