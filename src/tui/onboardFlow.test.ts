import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOnboardFlow, type OnboardDeps, type OnboardIO } from './onboardFlow.js';
import type { CtxhubConfig } from '../config/types.js';

function fakeConfig(overrides: Partial<CtxhubConfig> = {}): CtxhubConfig {
  return {
    version: 1,
    workspace: { name: 'ws' },
    repositories: [],
    knowledge: { include: [], exclude: [] },
    memory: { provider: 'local-json', path: '.ctxhub/memory' },
    index: { provider: 'local-json', path: '.ctxhub/index', table: 'chunks', incremental: true, chunkSize: 1800 },
    hooks: {},
    privacy: { redactPatterns: [] },
    ...overrides
  };
}

function directIo(): OnboardIO {
  return {
    suspendTerminal: async callback => {
      await callback();
    },
    askText: async (_message, defaultValue) => defaultValue,
    askConfirm: async (_message, defaultValue) => defaultValue,
    askMultiSelect: async () => []
  };
}

type Calls = {
  initCommand: unknown[][];
  repoDiscoverCommand: unknown[][];
  repoHookCommand: unknown[][];
  execa: unknown[][];
  skillsInstallCommand: unknown[][];
  agentLaunchCommand: unknown[][];
  indexCommand: unknown[][];
};

function fakeDeps(config: CtxhubConfig, overrides: Partial<OnboardDeps> = {}): { deps: OnboardDeps; calls: Calls } {
  const calls: Calls = {
    initCommand: [],
    repoDiscoverCommand: [],
    repoHookCommand: [],
    execa: [],
    skillsInstallCommand: [],
    agentLaunchCommand: [],
    indexCommand: []
  };

  const deps: OnboardDeps = {
    findConfigPath: async () => undefined,
    loadConfig: async () => config,
    initCommand: async (...args) => {
      calls.initCommand.push(args);
    },
    repoDiscoverCommand: async (...args) => {
      calls.repoDiscoverCommand.push(args);
    },
    repoHookCommand: async (...args) => {
      calls.repoHookCommand.push(args);
    },
    isMempalaceAvailable: async () => true,
    isCommandAvailable: async () => true,
    execa: (async (...args: unknown[]) => {
      calls.execa.push(args);
      return { stdout: '', stderr: '' };
    }) as OnboardDeps['execa'],
    skillsInstallCommand: async (...args) => {
      calls.skillsInstallCommand.push(args);
    },
    agentLaunchCommand: async (...args) => {
      calls.agentLaunchCommand.push(args);
    },
    indexCommand: async (...args) => {
      calls.indexCommand.push(args);
    },
    ...overrides
  };

  return { deps, calls };
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

test('runOnboardFlow initializes a new workspace when no config exists, using the answered name', async () => {
  const config = fakeConfig();
  const { deps, calls } = fakeDeps(config);
  const io = { ...directIo(), askText: async () => 'my-workspace' };

  await captureLog(() => runOnboardFlow('/tmp/ws', io, deps));

  assert.deepEqual(calls.initCommand, [[{ name: 'my-workspace' }]]);
});

test('runOnboardFlow skips workspace init and prints the existing config path when one is found', async () => {
  const config = fakeConfig();
  const { deps, calls } = fakeDeps(config, { findConfigPath: async () => '/tmp/ws/ctxhub.yaml' });

  const lines = await captureLog(() => runOnboardFlow('/tmp/ws', directIo(), deps));

  assert.deepEqual(calls.initCommand, []);
  assert.ok(lines.some(line => line.includes('Using existing config: /tmp/ws/ctxhub.yaml')));
});

test('runOnboardFlow discovers repos when none are configured and the user says yes', async () => {
  const config = fakeConfig();
  const { deps, calls } = fakeDeps(config);
  const io = { ...directIo(), askConfirm: async () => true };

  await captureLog(() => runOnboardFlow('/tmp/ws', io, deps));

  assert.deepEqual(calls.repoDiscoverCommand, [['.']]);
});

test('runOnboardFlow does not ask about hooks or indexing when there are no repos', async () => {
  const config = fakeConfig();
  const { deps, calls } = fakeDeps(config, { findConfigPath: async () => '/tmp/ws/ctxhub.yaml' });
  const askedMessages: string[] = [];
  const io: OnboardIO = {
    ...directIo(),
    askConfirm: async message => {
      askedMessages.push(message);
      return false;
    }
  };

  await captureLog(() => runOnboardFlow('/tmp/ws', io, deps));

  assert.deepEqual(calls.repoHookCommand, []);
  assert.deepEqual(calls.indexCommand, []);
  assert.ok(!askedMessages.some(message => message.includes('Auto-reindex')));
  assert.ok(!askedMessages.some(message => message.includes('Run an initial index')));
});

test('runOnboardFlow installs a hook per repo when repos exist and the user says yes, tolerating per-repo failures', async () => {
  const config = fakeConfig({ repositories: [{ name: 'a', path: './a' }, { name: 'b', path: './b' }] });
  const { deps, calls } = fakeDeps(config, {
    findConfigPath: async () => '/tmp/ws/ctxhub.yaml',
    repoHookCommand: async name => {
      calls.repoHookCommand.push([name]);
      if (name === 'b') throw new Error('not a git repo');
    }
  });
  const io = { ...directIo(), askConfirm: async () => true };

  const lines = await captureLog(() => runOnboardFlow('/tmp/ws', io, deps));

  assert.deepEqual(calls.repoHookCommand, [['a'], ['b']]);
  assert.ok(lines.some(line => line.includes('Skipped hook for b: not a git repo')));
});

test('runOnboardFlow installs MemPalace via uv when unavailable, the user says yes, and uv is on PATH', async () => {
  const config = fakeConfig({ memory: { provider: 'mempalace', path: '.ctxhub/memory' } });
  const { deps, calls } = fakeDeps(config, {
    findConfigPath: async () => '/tmp/ws/ctxhub.yaml',
    isMempalaceAvailable: async () => false,
    isCommandAvailable: async () => true
  });
  const io = { ...directIo(), askConfirm: async () => true };

  const lines = await captureLog(() => runOnboardFlow('/tmp/ws', io, deps));

  assert.deepEqual(calls.execa, [['uv', ['tool', 'install', 'mempalace']]]);
  assert.ok(lines.some(line => line.includes('MemPalace installed.')));
});

test('runOnboardFlow warns instead of installing MemPalace when uv is not on PATH', async () => {
  const config = fakeConfig({ memory: { provider: 'mempalace', path: '.ctxhub/memory' } });
  const { deps, calls } = fakeDeps(config, {
    findConfigPath: async () => '/tmp/ws/ctxhub.yaml',
    isMempalaceAvailable: async () => false,
    isCommandAvailable: async () => false
  });
  const io = { ...directIo(), askConfirm: async () => true };

  const lines = await captureLog(() => runOnboardFlow('/tmp/ws', io, deps));

  assert.deepEqual(calls.execa, []);
  assert.ok(lines.some(line => line.includes('uv not found on PATH')));
});

test('runOnboardFlow installs skills/MCP config only for selected agents that support agent launch', async () => {
  const { deps, calls } = fakeDeps(fakeConfig(), { findConfigPath: async () => '/tmp/ws/ctxhub.yaml' });
  const io: OnboardIO = { ...directIo(), askMultiSelect: async () => ['claude', 'cursor'] };

  await captureLog(() => runOnboardFlow('/tmp/ws', io, deps));

  assert.deepEqual(calls.skillsInstallCommand, [[['claude', 'cursor']]]);
  assert.deepEqual(calls.agentLaunchCommand, [['claude', { launch: false }]]);
});

test('runOnboardFlow runs an initial index when repos exist and the user says yes, then prints the completion banner', async () => {
  const config = fakeConfig({ repositories: [{ name: 'a', path: './a' }] });
  const { deps, calls } = fakeDeps(config, { findConfigPath: async () => '/tmp/ws/ctxhub.yaml' });
  const io = { ...directIo(), askConfirm: async () => true };

  const lines = await captureLog(() => runOnboardFlow('/tmp/ws', io, deps));

  assert.deepEqual(calls.indexCommand, [[{}]]);
  assert.ok(lines.some(line => line.includes('Onboarding complete.')));
});
