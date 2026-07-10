import os from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { execa } from '../utils/execa-lite.js';
import { readText } from '../utils/fs.js';
import type { CtxhubConfig, LlmAgentName } from '../config/types.js';
import { agentsWithCapability } from './harness.js';

export const LLM_AGENTS = agentsWithCapability('headlessInvocation');

export type RunAgentResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'disabled' | 'no-agent-available' | 'timeout' | 'error'; detail?: string };

type ExecFn = typeof execa;

export async function isAgentCliAvailable(agent: LlmAgentName, execFn: ExecFn = execa): Promise<boolean> {
  try {
    await execFn(agent, ['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function detectAvailableAgent(execFn: ExecFn = execa): Promise<LlmAgentName | undefined> {
  for (const agent of LLM_AGENTS) {
    if (await isAgentCliAvailable(agent, execFn)) return agent;
  }
  return undefined;
}

export function llmDisabledNotice(featureDescription: string): string {
  return (
    `AI-drafted ${featureDescription} is available but disabled. Enable with \`llm.enabled: true\` ` +
    'in ctxhub.yaml (uses your configured coding-agent CLI) to turn this on.'
  );
}

// Per-agent headless invocation. claude and codex are verified against real installed CLIs:
//   - claude: `claude -p` reads the prompt from stdin when none is given as an argument;
//     `--output-format text` (the default) returns clean plain text with no banner/preamble.
//   - codex: `codex exec ... -` reads the prompt from stdin; stdout carries a banner and
//     transcript, so `-o <file>` (--output-last-message) is used instead to get just the final
//     response cleanly, avoiding fragile banner-text parsing.
// copilot and cursor are best-effort / UNVERIFIED: no working installation of either was
// available while building this (the `copilot` binary found on this machine was a stub that
// prompts interactively to install the real CLI; `cursor` wasn't installed at all). Their
// invocations below follow common CLI conventions but have not been tested against a real
// response and may need adjusting once actually exercised.
async function invokeAgent(agent: LlmAgentName, prompt: string, timeoutMs: number, execFn: ExecFn): Promise<string> {
  switch (agent) {
    case 'claude': {
      const { stdout } = await execFn('claude', ['-p', '--output-format', 'text'], { input: prompt, timeoutMs });
      return stdout.trim();
    }
    case 'codex': {
      const outputFile = path.join(os.tmpdir(), `ctxhub-codex-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
      try {
        await execFn('codex', ['exec', '--skip-git-repo-check', '--color', 'never', '-o', outputFile, '-'], { input: prompt, timeoutMs });
        return (await readText(outputFile)).trim();
      } finally {
        await rm(outputFile, { force: true });
      }
    }
    case 'copilot': {
      const { stdout } = await execFn('copilot', ['-p', prompt], { timeoutMs });
      return stdout.trim();
    }
    case 'cursor': {
      const { stdout } = await execFn('cursor', ['agent', '-p', prompt], { timeoutMs });
      return stdout.trim();
    }
  }
}

// The single entry point every LLM-backed ctxhub feature calls. Never throws for expected
// failure modes (disabled, no agent found, timeout, invocation error) -- callers render the
// discriminated result, falling back to their non-LLM behavior rather than crashing.
export async function runAgentPrompt(config: CtxhubConfig, prompt: string, opts: { execFn?: ExecFn } = {}): Promise<RunAgentResult> {
  if (!config.llm.enabled) return { ok: false, reason: 'disabled' };

  const execFn = opts.execFn ?? execa;

  let agent: LlmAgentName | undefined;
  if (config.llm.agent) {
    // An explicitly configured agent is never silently swapped for another one -- if it's not
    // on PATH, that's reported clearly rather than falling back to a different CLI the user
    // didn't ask for.
    agent = (await isAgentCliAvailable(config.llm.agent, execFn)) ? config.llm.agent : undefined;
    if (!agent) {
      return { ok: false, reason: 'no-agent-available', detail: `Configured agent "${config.llm.agent}" was not found on PATH.` };
    }
  } else {
    agent = await detectAvailableAgent(execFn);
    if (!agent) {
      return { ok: false, reason: 'no-agent-available', detail: `No supported agent CLI (${LLM_AGENTS.join(', ')}) found on PATH.` };
    }
  }

  try {
    const text = await invokeAgent(agent, prompt, config.llm.timeoutMs, execFn);
    return { ok: true, text };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('timed out')) return { ok: false, reason: 'timeout', detail: message };
    return { ok: false, reason: 'error', detail: message };
  }
}
