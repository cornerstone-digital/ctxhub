import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createContextPack } from './pack.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-pack-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);
    process.chdir(cwd);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

// The ten words the long "user question" is built from. Boilerplate docs below repeat
// all of them to out-score the diagram on raw term-overlap alone -- deliberately not
// using the words "architecture"/"diagram"/"mermaid" so they don't also match the
// guaranteed prefix every architecture-diagram chunk carries (see chunk.ts's diagramChunk).
const QUESTION =
  'datadog authenticate agents runtime identity access profile evidence retrieval boundary policy';

test('createContextPack finds an architecture diagram even when many unrelated repos out-score it on a long question', () => {
  return withWorkspace(async cwd => {
    for (let i = 0; i < 5; i++) {
      const repoPath = path.join(cwd, `boilerplate-${i}`);
      await mkdir(repoPath, { recursive: true });
      await writeFile(path.join(repoPath, 'notes.md'), `# Notes\n\n${QUESTION}\n`);
    }

    const diagramRepoPath = path.join(cwd, 'aig-mcp-datadog');
    await mkdir(path.join(diagramRepoPath, 'docs', 'architecture'), { recursive: true });
    await writeFile(
      path.join(diagramRepoPath, 'docs', 'architecture', 'component-role.md'),
      ['# Component role', '', '```mermaid', 'flowchart LR', '  AGENT --> GATEWAY --> DD_MCP --> DD', '```', ''].join('\n')
    );

    const config = await loadConfig(cwd);
    for (let i = 0; i < 5; i++) {
      config.repositories.push({ name: `boilerplate-${i}`, path: `./boilerplate-${i}`, git: false });
    }
    config.repositories.push({ name: 'aig-mcp-datadog', path: './aig-mcp-datadog', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, cwd);

    await indexWorkspace(cwd);

    const question = `How does the ${QUESTION} work, and which repo owns that boundary?`;
    const pack = await createContextPack(question, 1, cwd);

    assert.equal(pack.architecture.length, 1, 'the diagram should still surface despite the small requested limit');
    assert.equal(pack.architecture[0].repo, 'aig-mcp-datadog');
    assert.equal(pack.architecture[0].kind, 'architecture-diagram');
  });
});

test('createContextPack still caps architecture results at the requested limit', () => {
  return withWorkspace(async cwd => {
    for (let i = 0; i < 3; i++) {
      const repoPath = path.join(cwd, `repo-${i}`);
      await mkdir(path.join(repoPath, 'docs', 'architecture'), { recursive: true });
      await writeFile(
        path.join(repoPath, 'docs', 'architecture', 'flow.mmd'),
        `flowchart LR\n  A${i} --> B${i}\n`
      );
    }

    const config = await loadConfig(cwd);
    for (let i = 0; i < 3; i++) {
      config.repositories.push({ name: `repo-${i}`, path: `./repo-${i}`, git: false });
    }
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, cwd);

    await indexWorkspace(cwd);

    const pack = await createContextPack('flowchart', 2, cwd);
    assert.ok(pack.architecture.length <= 2);
  });
});
