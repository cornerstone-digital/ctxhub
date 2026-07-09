import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { parse, stringify } from 'smol-toml';
import { agentLaunchCommand, launchAgentBinary, writeClaudeMcpConfig, writeCodexMcpConfig, writeCopilotMcpConfig } from './agent.js';
import { pathExists, readText } from '../utils/fs.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { isMempalaceAvailable } from '../memory/LocalJsonMemory.js';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-agent-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withCopilotHome(run: (dir: string) => Promise<void>) {
  return withTempDir(async dir => {
    const original = process.env.COPILOT_HOME;
    process.env.COPILOT_HOME = dir;
    try {
      await run(dir);
    } finally {
      if (original === undefined) delete process.env.COPILOT_HOME;
      else process.env.COPILOT_HOME = original;
    }
  });
}

test('writeClaudeMcpConfig creates .mcp.json when none exists', () => {
  return withTempDir(async dir => {
    const { path: configPath, changed } = await writeClaudeMcpConfig(dir);
    assert.equal(changed, true);

    const written = JSON.parse(await readText(configPath));
    assert.deepEqual(written.mcpServers.ctxhub, { command: 'ctxhub', args: ['mcp'] });
  });
});

test('writeClaudeMcpConfig merges into an existing .mcp.json without clobbering other servers', () => {
  return withTempDir(async dir => {
    const configPath = path.join(dir, '.mcp.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { other: { command: 'other-tool', args: ['serve'] } }, somethingElse: true }, null, 2)
    );

    await writeClaudeMcpConfig(dir);

    const written = JSON.parse(await readText(configPath));
    assert.deepEqual(written.mcpServers.other, { command: 'other-tool', args: ['serve'] });
    assert.deepEqual(written.mcpServers.ctxhub, { command: 'ctxhub', args: ['mcp'] });
    assert.equal(written.somethingElse, true);
  });
});

test('writeClaudeMcpConfig is idempotent once the ctxhub entry is already correct', () => {
  return withTempDir(async dir => {
    const first = await writeClaudeMcpConfig(dir);
    assert.equal(first.changed, true);

    const second = await writeClaudeMcpConfig(dir);
    assert.equal(second.changed, false);
  });
});

test('writeClaudeMcpConfig writes to the discovered workspace root from a child repo', () => {
  return withTempDir(async dir => {
    await initConfig('agent-ws', dir);
    const child = path.join(dir, 'app');
    await mkdir(child);

    const result = await writeClaudeMcpConfig(child);

    assert.equal(result.path, path.join(dir, '.mcp.json'));
    assert.equal(await pathExists(path.join(dir, '.mcp.json')), true);
    assert.equal(await pathExists(path.join(child, '.mcp.json')), false);
  });
});

test('writeCodexMcpConfig creates .codex/config.toml when none exists', () => {
  return withTempDir(async dir => {
    const { path: configPath, changed, note } = await writeCodexMcpConfig(dir);
    assert.equal(changed, true);
    assert.match(note ?? '', /trusts/);

    const written = parse(await readText(configPath)) as { mcp_servers: Record<string, unknown> };
    assert.deepEqual(written.mcp_servers.ctxhub, { command: 'ctxhub', args: ['mcp'] });
  });
});

test('writeCodexMcpConfig merges into an existing .codex/config.toml without clobbering other servers', () => {
  return withTempDir(async dir => {
    const configDir = path.join(dir, '.codex');
    const configPath = path.join(configDir, 'config.toml');
    await mkdir(configDir, { recursive: true });
    await writeFile(
      configPath,
      stringify({ mcp_servers: { other: { command: 'other-tool', args: ['serve'] } }, model: 'gpt-5-codex' })
    );

    await writeCodexMcpConfig(dir);

    const written = parse(await readText(configPath)) as Record<string, unknown> & { mcp_servers: Record<string, unknown> };
    assert.deepEqual(written.mcp_servers.other, { command: 'other-tool', args: ['serve'] });
    assert.deepEqual(written.mcp_servers.ctxhub, { command: 'ctxhub', args: ['mcp'] });
    assert.equal(written.model, 'gpt-5-codex');
  });
});

test('writeCodexMcpConfig is idempotent once the ctxhub entry is already correct', () => {
  return withTempDir(async dir => {
    const first = await writeCodexMcpConfig(dir);
    assert.equal(first.changed, true);

    const second = await writeCodexMcpConfig(dir);
    assert.equal(second.changed, false);
  });
});

test('writeCopilotMcpConfig creates ~/.copilot/mcp-config.json (COPILOT_HOME) when none exists', () => {
  return withCopilotHome(async dir => {
    const { path: configPath, changed, note } = await writeCopilotMcpConfig();
    assert.equal(changed, true);
    assert.match(note ?? '', /user-level config/);

    const written = JSON.parse(await readText(configPath));
    assert.deepEqual(written.mcpServers.ctxhub, { type: 'local', command: 'ctxhub', args: ['mcp'], tools: ['*'] });
    assert.equal(configPath, path.join(dir, 'mcp-config.json'));
  });
});

test('writeCopilotMcpConfig merges into an existing mcp-config.json without clobbering other servers', () => {
  return withCopilotHome(async dir => {
    const configPath = path.join(dir, 'mcp-config.json');
    await writeFile(
      configPath,
      JSON.stringify({ mcpServers: { other: { type: 'local', command: 'other-tool', args: ['serve'] } } }, null, 2)
    );

    await writeCopilotMcpConfig();

    const written = JSON.parse(await readText(configPath));
    assert.deepEqual(written.mcpServers.other, { type: 'local', command: 'other-tool', args: ['serve'] });
    assert.deepEqual(written.mcpServers.ctxhub, { type: 'local', command: 'ctxhub', args: ['mcp'], tools: ['*'] });
  });
});

test('writeCopilotMcpConfig is idempotent once the ctxhub entry is already correct', () => {
  return withCopilotHome(async () => {
    const first = await writeCopilotMcpConfig();
    assert.equal(first.changed, true);

    const second = await writeCopilotMcpConfig();
    assert.equal(second.changed, false);
  });
});

test('agentLaunchCommand copilot with --no-launch writes COPILOT_HOME/mcp-config.json', () => {
  return withCopilotHome(async dir => {
    await agentLaunchCommand('copilot', { launch: false });
    const written = JSON.parse(await readText(path.join(dir, 'mcp-config.json')));
    assert.deepEqual(written.mcpServers.ctxhub, { type: 'local', command: 'ctxhub', args: ['mcp'], tools: ['*'] });
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
      assert.deepEqual(written.mcpServers.ctxhub, { command: 'ctxhub', args: ['mcp'] });
    } finally {
      process.chdir(originalCwd);
    }
  });
});

test('agentLaunchCommand codex with --no-launch writes .codex/config.toml and prints the trust note', () => {
  return withTempDir(async dir => {
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      await agentLaunchCommand('codex', { launch: false });
      const written = parse(await readText(path.join(dir, '.codex', 'config.toml'))) as { mcp_servers: Record<string, unknown> };
      assert.deepEqual(written.mcp_servers.ctxhub, { command: 'ctxhub', args: ['mcp'] });
    } finally {
      process.chdir(originalCwd);
    }
  });
});

test('writeClaudeMcpConfig also wires up MemPalace when it is the configured provider, iff MemPalace is actually available', () => {
  return withTempDir(async dir => {
    await initConfig('ws', dir); // defaultConfig.memory.provider is 'mempalace'
    const mempalaceAvailable = await isMempalaceAvailable();

    const { note } = await writeClaudeMcpConfig(dir);
    const written = JSON.parse(await readText(path.join(dir, '.mcp.json')));

    if (mempalaceAvailable) {
      assert.deepEqual(written.mcpServers.mempalace, { command: 'mempalace-mcp', args: [] });
      assert.match(note ?? '', /MemPalace/);
    } else {
      assert.equal(written.mcpServers.mempalace, undefined);
      assert.equal(note, undefined);
    }
  });
});

test('writeClaudeMcpConfig does not add a MemPalace entry when the workspace uses local-json memory', () => {
  return withTempDir(async dir => {
    await initConfig('ws', dir);
    const config = await loadConfig(dir);
    config.memory.provider = 'local-json';
    await saveConfig(config, dir);

    const { note } = await writeClaudeMcpConfig(dir);
    const written = JSON.parse(await readText(path.join(dir, '.mcp.json')));
    assert.equal(written.mcpServers.mempalace, undefined);
    assert.equal(note, undefined);
  });
});

test('writeClaudeMcpConfig skips MemPalace wiring gracefully when there is no ctxhub config at all', () => {
  return withTempDir(async dir => {
    const { note } = await writeClaudeMcpConfig(dir);
    const written = JSON.parse(await readText(path.join(dir, '.mcp.json')));
    assert.equal(written.mcpServers.mempalace, undefined);
    assert.equal(note, undefined);
  });
});

test('launchAgentBinary rejects with a friendly error when the binary is missing', () => {
  return withTempDir(async dir => {
    await assert.rejects(
      () => launchAgentBinary('ctxhub-test-nonexistent-binary-xyz', [], dir),
      /was not found on PATH/
    );
  });
});
