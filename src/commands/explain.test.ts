import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { buildAnswerLines, createExplainResult, type ExplainEvidence } from './explain.js';
import { initConfig, loadConfig, saveConfig } from '../config/config.js';
import { indexWorkspace } from '../indexing/indexer.js';
import { initAgentsDirectory } from '../personas/persona.js';
import type { CtxhubConfig } from '../config/types.js';
import type { RunAgentResult } from '../llm/runAgent.js';

test('buildAnswerLines produces a no-evidence scaffold', () => {
  assert.deepEqual(buildAnswerLines([]), [
    'No indexed evidence matched this query. Run ctxhub index or broaden the query.'
  ]);
});

test('buildAnswerLines cites architecture and context evidence refs', () => {
  const evidence: ExplainEvidence[] = [
    {
      ref: 'E1',
      repo: 'api',
      path: 'docs/architecture/runtime.mmd',
      snippet: 'api --> web',
      stale: false,
      kind: 'architecture'
    },
    {
      ref: 'E2',
      repo: 'api',
      path: 'README.md',
      snippet: 'auth details',
      stale: false,
      kind: 'context'
    }
  ];

  const lines = buildAnswerLines(evidence);
  assert.match(lines[0], /\[E1\]/);
  assert.match(lines[1], /\[E2\]/);
  assert.match(lines[2], /source of truth/);
});

async function withWorkspace(run: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-explain-'));
  try {
    await initConfig('ws', cwd);
    await mkdir(path.join(cwd, 'app'), { recursive: true });
    await writeFile(path.join(cwd, 'app', 'README.md'), '# App\n\n## Authentication flow\n\nAuth details for testing.\n');

    const config = await loadConfig(cwd);
    config.repositories.push({ name: 'app', path: './app', git: false });
    config.index.provider = 'local-json';
    config.index.path = '.ctxhub/index/local.json';
    await saveConfig(config, cwd);

    await indexWorkspace(cwd);
    await run(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

// Mirrors the real runAgentPrompt's contract: checks config.llm.enabled itself and returns the
// `disabled` result if it's off, rather than always returning whatever canned result was given.
// Using an unconditional fake would let a test "pass" even if the enabled flag were ignored.
function fakeRunAgentPromptFn(whenEnabled: RunAgentResult) {
  return async (config: CtxhubConfig): Promise<RunAgentResult> => (config.llm.enabled ? whenEnabled : { ok: false, reason: 'disabled' });
}

test('createExplainResult falls back to the evidence scaffold with a disabled notice when llm.enabled is false', () => {
  return withWorkspace(async cwd => {
    const result = await createExplainResult('authentication flow', 8, cwd, {
      runAgentPromptFn: fakeRunAgentPromptFn({ ok: false, reason: 'disabled' })
    });
    assert.ok(result.evidence.length > 0, 'expected the fixture README to match');
    assert.match(result.llmNotice ?? '', /llm\.enabled: true/);
    assert.match(result.answer.join(' '), /source of truth/);
  });
});

test('createExplainResult uses the synthesized answer and drops llmNotice when the LLM call succeeds', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    await saveConfig(config, cwd);

    const result = await createExplainResult('authentication flow', 8, cwd, {
      runAgentPromptFn: fakeRunAgentPromptFn({ ok: true, text: 'Auth works via [E1] token validation.' })
    });
    assert.deepEqual(result.answer, ['Auth works via [E1] token validation.']);
    assert.equal(result.llmNotice, undefined);
    // Citations/evidence stay grounded in the real index regardless of the LLM path.
    assert.ok(result.citations.some(c => c.ref === 'E1'));
  });
});

test('createExplainResult falls back gracefully with a clear notice when the LLM call times out', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    await saveConfig(config, cwd);

    const result = await createExplainResult('authentication flow', 8, cwd, {
      runAgentPromptFn: fakeRunAgentPromptFn({ ok: false, reason: 'timeout', detail: 'timed out after 120000ms' })
    });
    assert.match(result.llmNotice ?? '', /unavailable \(timeout\)/);
    assert.match(result.answer.join(' '), /source of truth/);
  });
});

test('createExplainResult --llm override attempts synthesis even when config has it disabled', () => {
  return withWorkspace(async cwd => {
    let called = false;
    const result = await createExplainResult('authentication flow', 8, cwd, {
      llmOverride: true,
      runAgentPromptFn: async () => {
        called = true;
        return { ok: true, text: 'Forced synthesis.' };
      }
    });
    assert.equal(called, true);
    assert.deepEqual(result.answer, ['Forced synthesis.']);
  });
});

test('createExplainResult --no-llm override falls back to the scaffold even when config has llm.enabled true', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    await saveConfig(config, cwd);

    // A realistic fake (checks config.llm.enabled itself, like the real function) proves the
    // override actually flipped the *effective* config to disabled for this one call, rather
    // than just checking whether resolveAnswer happened to call the function at all.
    const result = await createExplainResult('authentication flow', 8, cwd, {
      llmOverride: false,
      runAgentPromptFn: fakeRunAgentPromptFn({ ok: true, text: 'should not be used' })
    });
    assert.match(result.llmNotice ?? '', /llm\.enabled: true/);
    assert.match(result.answer.join(' '), /source of truth/);
  });
});

test('createExplainResult never calls the LLM when there is no evidence to synthesize from', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    await saveConfig(config, cwd);

    let called = false;
    // LocalJsonIndex's lexicalSearch filters out zero-term-overlap documents entirely
    // (score > 0 only), so a query sharing no words with the indexed README deterministically
    // yields zero evidence.
    const result = await createExplainResult('zzzqqqxxx wibblewobble nonexistentterm', 8, cwd, {
      runAgentPromptFn: async () => {
        called = true;
        return { ok: true, text: 'should not be used' };
      }
    });
    assert.equal(result.evidence.length, 0);
    assert.equal(called, false);
  });
});

test('createExplainResult prompt has no policy/persona preamble at all when agents/ has not been initialized (docs/personas.md Phase 1 guarantee)', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    await saveConfig(config, cwd);

    let capturedPrompt = '';
    await createExplainResult('authentication flow', 8, cwd, {
      runAgentPromptFn: async (_config, prompt) => {
        capturedPrompt = prompt;
        return { ok: true, text: 'answer' };
      }
    });

    assert.ok(!capturedPrompt.includes('Policy ('), 'no agents/ directory means no policy text, ever');
    assert.ok(!capturedPrompt.includes('Persona:'));
    assert.ok(capturedPrompt.startsWith('Question: authentication flow'), 'prompt must start exactly like it did before personas existed');
  });
});

test('createExplainResult applies a configured policy to every call once a team opts in, even without --as (policy is not persona-gated)', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    await saveConfig(config, cwd);
    await initAgentsDirectory(cwd);

    let capturedPrompt = '';
    await createExplainResult('authentication flow', 8, cwd, {
      runAgentPromptFn: async (_config, prompt) => {
        capturedPrompt = prompt;
        return { ok: true, text: 'answer' };
      }
    });

    assert.match(capturedPrompt, /Policy \(always applies/);
    assert.ok(!capturedPrompt.includes('Persona:'), 'no --as means no persona text, but the policy still applies');
  });
});

test('createExplainResult includes the persona and policy text in the prompt when --as names a real persona', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    await saveConfig(config, cwd);
    await initAgentsDirectory(cwd);

    let capturedPrompt = '';
    await createExplainResult('authentication flow', 8, cwd, {
      persona: 'architect',
      runAgentPromptFn: async (_config, prompt) => {
        capturedPrompt = prompt;
        return { ok: true, text: 'answer' };
      }
    });

    assert.match(capturedPrompt, /Policy \(always applies/);
    assert.match(capturedPrompt, /never invent/);
    assert.match(capturedPrompt, /Persona: architect/);
    assert.match(capturedPrompt, /Software Architect/);
    // The persona/policy preamble must come before the command's own existing instructions --
    // proving assembly order, not just presence.
    assert.ok(capturedPrompt.indexOf('Persona:') < capturedPrompt.indexOf('Question:'));
    // Citation discipline is still there even with a persona active -- the persona cannot loosen it.
    assert.match(capturedPrompt, /cite only these refs/);
  });
});

test('createExplainResult silently proceeds without a persona block when --as names a persona that does not exist', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    await saveConfig(config, cwd);
    await initAgentsDirectory(cwd);

    let capturedPrompt = '';
    await createExplainResult('authentication flow', 8, cwd, {
      persona: 'not-a-real-persona',
      runAgentPromptFn: async (_config, prompt) => {
        capturedPrompt = prompt;
        return { ok: true, text: 'answer' };
      }
    });

    assert.ok(!capturedPrompt.includes('Persona:'));
    // The configured policy still applies even though the named persona doesn't exist.
    assert.match(capturedPrompt, /Policy \(always applies/);
  });
});

// docs/control-plane.md Phase 4: --profile resolves a named executionProfiles entry.
test('createExplainResult rejects an unknown --profile name before doing any work', () => {
  return withWorkspace(async cwd => {
    await assert.rejects(
      () => createExplainResult('authentication flow', 8, cwd, { profile: 'not-a-real-profile' }),
      /No execution profile named "not-a-real-profile"/
    );
  });
});

test('createExplainResult --profile defaults the framing persona from the profile when --as is not given', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    config.executionProfiles = { 'architect-primary': { persona: 'architect', runtime: 'claude', model: 'claude-opus-4' } };
    await saveConfig(config, cwd);
    await initAgentsDirectory(cwd);

    let capturedPrompt = '';
    let capturedOpts: { agent?: string; model?: string } | undefined;
    await createExplainResult('authentication flow', 8, cwd, {
      profile: 'architect-primary',
      runAgentPromptFn: async (_config, prompt, opts) => {
        capturedPrompt = prompt;
        capturedOpts = opts;
        return { ok: true, text: 'answer' };
      }
    });

    assert.match(capturedPrompt, /Persona: architect/);
    assert.deepEqual(capturedOpts, { agent: 'claude', model: 'claude-opus-4' });
  });
});

test('createExplainResult --as wins over the profile\'s own persona for framing, while the profile still picks the runtime/model', () => {
  return withWorkspace(async cwd => {
    const config = await loadConfig(cwd);
    config.llm.enabled = true;
    config.executionProfiles = { 'architect-primary': { persona: 'architect', runtime: 'codex', model: 'gpt-5' } };
    await saveConfig(config, cwd);
    await initAgentsDirectory(cwd);

    let capturedPrompt = '';
    let capturedOpts: { agent?: string; model?: string } | undefined;
    await createExplainResult('authentication flow', 8, cwd, {
      persona: 'not-a-real-persona',
      profile: 'architect-primary',
      runAgentPromptFn: async (_config, prompt, opts) => {
        capturedPrompt = prompt;
        capturedOpts = opts;
        return { ok: true, text: 'answer' };
      }
    });

    assert.deepEqual(capturedOpts, { agent: 'codex', model: 'gpt-5' });
    // --as's own (nonexistent) name is what's actually used for framing, not the profile's
    // "architect" -- proving --as takes priority in persona resolution, not just that some
    // persona or other loaded successfully.
    assert.ok(!capturedPrompt.includes('Persona:'));
  });
});
