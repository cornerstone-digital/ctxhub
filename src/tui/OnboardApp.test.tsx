import { test } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { render } from 'ink-testing-library';
import { OnboardApp } from './OnboardApp.js';
import type { OnboardDeps } from './onboardFlow.js';
import type { CtxhubConfig } from '../config/types.js';

const ENTER = '\r';
const SPACE = ' ';
const DOWN = '[B';

function wait(ms = 30): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
    llm: { enabled: false, timeoutMs: 120000 },
    ...overrides
  };
}

function baseDeps(config: CtxhubConfig, calls: { skillsInstallCommand: unknown[][] }): OnboardDeps {
  return {
    findConfigPath: async () => '/tmp/ws/ctxhub.yaml',
    loadConfig: async () => config,
    initCommand: async () => undefined,
    repoDiscoverCommand: async () => undefined,
    repoHookCommand: async () => undefined,
    isMempalaceAvailable: async () => true,
    isCommandAvailable: async () => true,
    execa: (async () => ({ stdout: '', stderr: '' })) as OnboardDeps['execa'],
    skillsInstallCommand: async (...args) => {
      calls.skillsInstallCommand.push(args);
    },
    agentLaunchCommand: async () => undefined,
    indexCommand: async () => undefined,
    createContextPack: (async () => ({
      query: 'x', workspace: 'ws', generatedAt: '', repos: [], search: [], architecture: [], resultTypes: {}, suggestedReadingOrder: [], localFollowUpCommands: [], guidance: []
    })) as OnboardDeps['createContextPack'],
    runAgentPrompt: (async () => ({ ok: false, reason: 'disabled' })) as OnboardDeps['runAgentPrompt']
  };
}

test('OnboardApp asks a confirm question and advances on enter', async () => {
  const config = fakeConfig({ repositories: [{ name: 'app', path: './app' }] });
  const calls = { skillsInstallCommand: [] as unknown[][] };
  const deps = baseDeps(config, calls);

  const { stdin, lastFrame, unmount } = render(React.createElement(OnboardApp, { cwd: '/tmp/ws', deps }));

  try {
    await wait();
    let frame = lastFrame() ?? '';
    assert.match(frame, /Auto-reindex on every commit\?/);

    stdin.write(DOWN); // move to "No"
    await wait();
    stdin.write(ENTER); // confirm "No"
    await wait();

    frame = lastFrame() ?? '';
    assert.match(frame, /Which coding agents/);
  } finally {
    unmount();
  }
});

test('OnboardApp multi-select: space toggles an agent, enter confirms the selection and installs skills', async () => {
  // Non-empty repos skips the "discover repos" question; answering "No" to the
  // following "auto-reindex on commit" question (memory provider is local-json, so
  // the mempalace question is skipped entirely) lands on the agents multi-select.
  const config = fakeConfig({ repositories: [{ name: 'app', path: './app' }] });
  const calls = { skillsInstallCommand: [] as unknown[][] };
  const deps = baseDeps(config, calls);

  const { stdin, lastFrame, unmount } = render(React.createElement(OnboardApp, { cwd: '/tmp/ws', deps }));

  try {
    await wait();
    assert.match(lastFrame() ?? '', /Auto-reindex on every commit\?/);
    stdin.write(DOWN); // move to "No"
    await wait();
    stdin.write(ENTER); // confirm "No"
    await wait();

    const frame = lastFrame() ?? '';
    assert.match(frame, /Which coding agents do you use\?/);
    assert.match(frame, /\[ \] claude/);

    // Extra settle time here: the multiselect screen just mounted (replacing the
    // confirm screen via React's `key`-driven remount), and its useInput effect
    // needs a tick to attach before it can see the next keystroke.
    await wait(50);
    stdin.write(SPACE); // toggle first choice on
    await wait(50);
    stdin.write(ENTER); // confirm selection
    await wait(50);

    assert.equal(calls.skillsInstallCommand.length, 1);
    assert.deepEqual(calls.skillsInstallCommand[0][0], ['claude']);
  } finally {
    unmount();
  }
});
