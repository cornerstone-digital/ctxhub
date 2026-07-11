import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { chunkPromoteCommand, chunkListCommand } from './chunk.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { createIndexProvider } from '../indexing/providers.js';

// ── helpers ───────────────────────────────────────────────────────────────────

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-chunk-'));
  const originalCwd = process.cwd();
  try {
    await initConfig('ws', cwd);

    const repoPath = path.join(cwd, 'docs');
    await mkdir(repoPath, { recursive: true });
    await writeFile(
      path.join(repoPath, 'guide.md'),
      '# Guide\n\n## Setup\n\nInstall and configure the tool.\n'
    );

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'docs', path: './docs', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, cwd);

    process.chdir(cwd);
    await indexWorkspace(cwd);
    await run(cwd);
  } finally {
    process.chdir(originalCwd);
    await rm(cwd, { recursive: true, force: true });
  }
}

async function captureLog(run: () => Promise<void>): Promise<{ out: string[]; err: string[] }> {
  const out: string[] = [];
  const err: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: unknown[]) => out.push(args.join(' '));
  console.error = (...args: unknown[]) => err.push(args.join(' '));
  try {
    await run();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return { out, err };
}

/** Run fn and intercept process.exit; returns the exit code if it was called. */
async function captureExit(fn: () => Promise<void>): Promise<{ exitCode: number | undefined }> {
  let exitCode: number | undefined;
  const original = process.exit;
  (process as NodeJS.Process).exit = ((code?: number) => {
    exitCode = code;
    throw new Error(`process.exit(${code})`);
  }) as typeof process.exit;
  try {
    await fn();
  } catch {
    // swallow the thrown sentinel error from our fake exit
  } finally {
    (process as NodeJS.Process).exit = original;
  }
  return { exitCode };
}

async function getFirstChunkId(cwd: string): Promise<string> {
  const config = await loadConfig(cwd);
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
  const chunks = await index.recent(10);
  assert.ok(chunks.length > 0, 'Expected at least one indexed chunk');
  return chunks[0].id;
}

// ── chunkPromoteCommand ───────────────────────────────────────────────────────

test('chunkPromoteCommand rejects an invalid tier', () => {
  return withWorkspace(async () => {
    const { exitCode } = await captureExit(async () => {
      const { err } = await captureLog(() =>
        chunkPromoteCommand('any-id', { tier: 'totally-bogus' })
      );
      assert.ok(err.some(line => line.includes('Invalid tier')));
    });
    assert.equal(exitCode, 1);
  });
});

test('chunkPromoteCommand rejects "promoted" as a promotable tier', () => {
  return withWorkspace(async () => {
    const { exitCode } = await captureExit(async () => {
      await captureLog(() => chunkPromoteCommand('any-id', { tier: 'promoted' }));
    });
    assert.equal(exitCode, 1);
  });
});

test('chunkPromoteCommand rejects "unverified" as a promotable tier', () => {
  return withWorkspace(async () => {
    const { exitCode } = await captureExit(async () => {
      await captureLog(() => chunkPromoteCommand('any-id', { tier: 'unverified' }));
    });
    assert.equal(exitCode, 1);
  });
});

test('chunkPromoteCommand returns error when chunk is not found', () => {
  return withWorkspace(async () => {
    const { exitCode } = await captureExit(async () => {
      const { err } = await captureLog(() =>
        chunkPromoteCommand('nonexistent-chunk-id-000', { tier: 'institutional' })
      );
      assert.ok(err.some(line => line.includes('not found') || line.includes('nonexistent')));
    });
    assert.equal(exitCode, 1);
  });
});

test('chunkPromoteCommand promotes a chunk to institutional tier', () => {
  return withWorkspace(async cwd => {
    const chunkId = await getFirstChunkId(cwd);
    const { out } = await captureLog(() =>
      chunkPromoteCommand(chunkId, { tier: 'institutional' })
    );
    assert.ok(out.some(line => line.includes('promoted') && line.includes('institutional')));
  });
});

test('chunkPromoteCommand promotes a chunk to canonical tier', () => {
  return withWorkspace(async cwd => {
    const chunkId = await getFirstChunkId(cwd);
    const { out } = await captureLog(() =>
      chunkPromoteCommand(chunkId, { tier: 'canonical' })
    );
    assert.ok(out.some(line => line.includes('promoted') && line.includes('canonical')));
  });
});

test('chunkPromoteCommand sets promotedAt on the chunk', () => {
  return withWorkspace(async cwd => {
    const chunkId = await getFirstChunkId(cwd);
    const before = Date.now();
    await captureLog(() => chunkPromoteCommand(chunkId, { tier: 'institutional' }));
    const config = await loadConfig(cwd);
    const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
    const updated = await index.getDocument(chunkId);
    assert.ok(updated?.promotedAt, 'promotedAt should be set');
    const promotedTime = new Date(updated!.promotedAt!).getTime();
    assert.ok(promotedTime >= before, 'promotedAt should be >= start of test');
  });
});

test('chunkPromoteCommand sets promotedBy to "cli" by default', () => {
  return withWorkspace(async cwd => {
    const chunkId = await getFirstChunkId(cwd);
    await captureLog(() => chunkPromoteCommand(chunkId, { tier: 'institutional' }));
    const config = await loadConfig(cwd);
    const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
    const updated = await index.getDocument(chunkId);
    assert.equal(updated?.promotedBy, 'cli');
  });
});

test('chunkPromoteCommand sets promotedBy to the --by value when provided', () => {
  return withWorkspace(async cwd => {
    const chunkId = await getFirstChunkId(cwd);
    await captureLog(() =>
      chunkPromoteCommand(chunkId, { tier: 'institutional', by: 'martin' })
    );
    const config = await loadConfig(cwd);
    const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
    const updated = await index.getDocument(chunkId);
    assert.equal(updated?.promotedBy, 'martin');
  });
});

test('chunkPromoteCommand accepts a prefix of the chunk id', () => {
  return withWorkspace(async cwd => {
    const chunkId = await getFirstChunkId(cwd);
    const prefix = chunkId.slice(0, 10);
    const { out } = await captureLog(() =>
      chunkPromoteCommand(prefix, { tier: 'institutional' })
    );
    assert.ok(out.some(line => line.includes('promoted') && line.includes('institutional')));
  });
});

// ── chunkListCommand ──────────────────────────────────────────────────────────

test('chunkListCommand rejects an invalid min-tier', () => {
  return withWorkspace(async () => {
    const { exitCode } = await captureExit(async () => {
      const { err } = await captureLog(() =>
        chunkListCommand({ minTier: 'badtier' })
      );
      assert.ok(err.some(line => line.includes('Invalid tier')));
    });
    assert.equal(exitCode, 1);
  });
});

test('chunkListCommand shows all chunks when minTier is unverified', () => {
  return withWorkspace(async () => {
    const { out } = await captureLog(() => chunkListCommand({ minTier: 'unverified' }));
    assert.ok(out.some(line => line.includes('chunk')));
  });
});

test('chunkListCommand shows no chunks at institutional tier before any promotions', () => {
  return withWorkspace(async () => {
    const { out } = await captureLog(() => chunkListCommand({ minTier: 'institutional' }));
    // Either "No chunks found" message or the output has no results
    assert.ok(
      out.some(line => line.toLowerCase().includes('no chunks')) ||
      !out.some(line => line.includes('institutional'))
    );
  });
});

test('promoted chunk appears in chunkListCommand at institutional tier', () => {
  return withWorkspace(async cwd => {
    const chunkId = await getFirstChunkId(cwd);
    await captureLog(() => chunkPromoteCommand(chunkId, { tier: 'institutional' }));

    const { out } = await captureLog(() => chunkListCommand({ minTier: 'institutional' }));
    assert.ok(out.some(line => line.includes('institutional')));
    assert.ok(out.some(line => line.includes(chunkId.slice(0, 12))));
  });
});

test('promoted chunk appears in list with its new tier', () => {
  return withWorkspace(async cwd => {
    const chunkId = await getFirstChunkId(cwd);
    await captureLog(() => chunkPromoteCommand(chunkId, { tier: 'canonical' }));

    const { out } = await captureLog(() => chunkListCommand({ minTier: 'canonical' }));
    assert.ok(out.some(line => line.includes('canonical')));
  });
});
