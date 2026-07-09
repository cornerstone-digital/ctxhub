import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { agentLaunchCommand, launchAgentBinary, writeSsdMcpConfig } from './agent.js';
import { readText } from '../utils/fs.js';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ssd-agent-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('writeSsdMcpConfig creates .mcp.json when none exists', () => {
  return withTempDir(async dir => {
    const { path: configPath, changed } = await writeSsdMcpConfig(dir);
    assert.equal(changed, true);

    const written = JSON.parse(await readText(configPath));
    assert.deepEqual(written.mcpServers.ssd, { command: 'ssd', args: ['mcp'] });
  });
});

test('writeSsdMcpConfig merges into an existing .mcp.json without clobbering other servers', () => {
  return withTempDir(async dir => {
    const configPath = path.join(dir, '.mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { other: { command: 'other-tool', args: ['serve'] } }, somethingElse: true }, null, 2)
    );

    await writeSsdMcpConfig(dir);

    const written = JSON.parse(await readText(configPath));
    assert.deepEqual(written.mcpServers.other, { command: 'other-tool', args: ['serve'] });
    assert.deepEqual(written.mcpServers.ssd, { command: 'ssd', args: ['mcp'] });
    assert.equal(written.somethingElse, true);
  });
});

test('writeSsdMcpConfig is idempotent once the ssd entry is already correct', () => {
  return withTempDir(async dir => {
    const first = await writeSsdMcpConfig(dir);
    assert.equal(first.changed, true);

    const second = await writeSsdMcpConfig(dir);
    assert.equal(second.changed, false);
  });
});

test('agentLaunchCommand rejects unsupported agent names', () => {
  return withTempDir(async dir => {
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      await assert.rejects(() => agentLaunchCommand('nonexistent-agent'), /Unsupported agent/);
    } finally {
      process.chdir(originalCwd);
    }
  });
});

test('agentLaunchCommand with --no-launch only writes the MCP config', () => {
  return withTempDir(async dir => {
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      await agentLaunchCommand('claude', { launch: false });
      const written = JSON.parse(await readText(path.join(dir, '.mcp.json')));
      assert.deepEqual(written.mcpServers.ssd, { command: 'ssd', args: ['mcp'] });
    } finally {
      process.chdir(originalCwd);
    }
  });
});

test('launchAgentBinary rejects with a friendly error when the binary is missing', () => {
  return withTempDir(async dir => {
    await assert.rejects(
      () => launchAgentBinary('ssd-test-nonexistent-binary-xyz', [], dir),
      /was not found on PATH/
    );
  });
});
