import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { detectAvailableAgent, isAgentCliAvailable, llmDisabledNotice, LLM_AGENTS, runAgentPrompt } from './runAgent.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig } from '../config/types.js';

function config(overrides: Partial<CtxhubConfig['llm']> = {}): CtxhubConfig {
  return { ...defaultConfig, llm: { ...defaultConfig.llm, ...overrides } };
}

function fakeExec(behavior: Record<string, () => Promise<{ stdout: string; stderr: string }>>) {
  return (command: string) => {
    const handler = behavior[command];
    if (!handler) return Promise.reject(new Error(`${command} not found on PATH`));
    return handler();
  };
}

test('isAgentCliAvailable reports true when the probe succeeds, false when it rejects', async () => {
  const ok = await isAgentCliAvailable('claude', fakeExec({ claude: async () => ({ stdout: '1.0.0', stderr: '' }) }) as never);
  assert.equal(ok, true);

  const missing = await isAgentCliAvailable('claude', fakeExec({}) as never);
  assert.equal(missing, false);
});

test('detectAvailableAgent returns the first available agent in LLM_AGENTS order', async () => {
  const execFn = fakeExec({ copilot: async () => ({ stdout: '1.0.0', stderr: '' }) });
  const agent = await detectAvailableAgent(execFn as never);
  assert.equal(agent, 'copilot');
});

test('detectAvailableAgent returns undefined when nothing is on PATH', async () => {
  const agent = await detectAvailableAgent(fakeExec({}) as never);
  assert.equal(agent, undefined);
});

test('llmDisabledNotice explains what to enable and why', () => {
  const notice = llmDisabledNotice('a PR description');
  assert.match(notice, /a PR description/);
  assert.match(notice, /llm\.enabled: true/);
});

test('runAgentPrompt returns disabled without touching exec at all', async () => {
  const result = await runAgentPrompt(config({ enabled: false }), 'prompt', {
    execFn: (() => { throw new Error('should not be called'); }) as never
  });
  assert.deepEqual(result, { ok: false, reason: 'disabled' });
});

test('runAgentPrompt auto-detects and invokes an available agent, trimming its output', async () => {
  const execFn = fakeExec({
    claude: async () => ({ stdout: '  synthesized answer  \n', stderr: '' })
  });
  const result = await runAgentPrompt(config({ enabled: true }), 'prompt', { execFn: execFn as never });
  assert.deepEqual(result, { ok: true, text: 'synthesized answer' });
});

test('runAgentPrompt reports no-agent-available when nothing on PATH responds', async () => {
  const result = await runAgentPrompt(config({ enabled: true }), 'prompt', { execFn: fakeExec({}) as never });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'no-agent-available');
});

test('runAgentPrompt never silently substitutes a different agent than explicitly configured', async () => {
  // codex is "available" here, but the user configured claude specifically -- must not fall back.
  const execFn = fakeExec({ codex: async () => ({ stdout: 'ignored', stderr: '' }) });
  const result = await runAgentPrompt(config({ enabled: true, agent: 'claude' }), 'prompt', { execFn: execFn as never });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'no-agent-available');
  assert.match((result as { detail: string }).detail, /"claude"/);
});

test('runAgentPrompt maps a timeout error to the timeout reason', async () => {
  // The --version availability probe must succeed so detection reaches the real invocation;
  // only the actual prompt call times out.
  const execFn = (_command: string, args: string[]) =>
    args.includes('--version')
      ? Promise.resolve({ stdout: '1.0.0', stderr: '' })
      : Promise.reject(new Error('claude -p timed out after 50ms'));
  const result = await runAgentPrompt(config({ enabled: true }), 'prompt', { execFn: execFn as never });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'timeout');
});

test('LLM_AGENTS lists all four supported agent CLIs', () => {
  assert.deepEqual([...LLM_AGENTS], ['claude', 'codex', 'copilot', 'cursor']);
});

// docs/control-plane.md Phase 4: an Execution Profile's runtime/model are per-call overrides.
test("runAgentPrompt's opts.agent overrides config.llm.agent, taking priority", async () => {
  const execFn = async (_command: string, args: string[]) => {
    if (args.includes('--version')) return { stdout: '1.0.0', stderr: '' };
    // Mirrors invokeAgent's real codex path: it reads back whatever `-o <file>` the codex CLI
    // itself would have written.
    const outputFile = args[args.indexOf('-o') + 1];
    await writeFile(outputFile, 'from codex\n', 'utf8');
    return { stdout: '', stderr: '' };
  };
  const result = await runAgentPrompt(config({ enabled: true, agent: 'claude' }), 'prompt', {
    execFn: execFn as never,
    agent: 'codex'
  });
  assert.deepEqual(result, { ok: true, text: 'from codex' });
});

test('runAgentPrompt reports no-agent-available with a profile-specific message when opts.agent is not on PATH', async () => {
  const result = await runAgentPrompt(config({ enabled: true, agent: 'claude' }), 'prompt', {
    execFn: fakeExec({ claude: async () => ({ stdout: 'ignored', stderr: '' }) }) as never,
    agent: 'codex'
  });
  assert.equal(result.ok, false);
  assert.equal((result as { reason: string }).reason, 'no-agent-available');
  assert.match((result as { detail: string }).detail, /Execution profile's runtime "codex"/);
});

test('runAgentPrompt passes opts.model through as --model for claude', async () => {
  let capturedArgs: string[] = [];
  const execFn = (_command: string, args: string[]) => {
    capturedArgs = args;
    return Promise.resolve({ stdout: 'ok', stderr: '' });
  };
  await runAgentPrompt(config({ enabled: true, agent: 'claude' }), 'prompt', { execFn: execFn as never, model: 'claude-opus-4' });
  assert.deepEqual(capturedArgs, ['-p', '--output-format', 'text', '--model', 'claude-opus-4']);
});

test('runAgentPrompt passes opts.model through as -m for codex', async () => {
  let capturedArgs: string[] = [];
  const execFn = async (_command: string, args: string[]) => {
    if (args.includes('--version')) return { stdout: '1.0.0', stderr: '' };
    capturedArgs = args;
    // Mirrors invokeAgent's real codex path: it reads back whatever `-o <file>` the codex CLI
    // itself would have written, so the fake has to actually write that file.
    const outputFile = args[args.indexOf('-o') + 1];
    await writeFile(outputFile, 'codex response\n', 'utf8');
    return { stdout: '', stderr: '' };
  };
  await runAgentPrompt(config({ enabled: true, agent: 'codex' }), 'prompt', { execFn: execFn as never, model: 'gpt-5' });
  assert.ok(capturedArgs.includes('-m'), 'expected -m flag in codex invocation args');
  assert.ok(capturedArgs.includes('gpt-5'));
});
