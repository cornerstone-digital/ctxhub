import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentsWithCapability } from './harness.js';
import { SUPPORTED_AGENTS } from '../commands/agent.js';
import { SUPPORTED_SKILL_AGENTS } from '../commands/skills.js';
import { LLM_AGENTS } from './runAgent.js';

// NEXT_FEATURES #29: agent.ts/skills.ts/runAgent.ts now derive their exported lists from one
// shared AGENT_CAPABILITIES table instead of three independently-maintained arrays. This test is
// the safety net the plan called for: it pins today's exact membership per list (including the
// real, pre-existing gap -- cursor has no MCP-config-writing support -- that #29 deliberately does
// not close) so a future edit to harness.ts can't silently re-diverge any of the three without a
// test failing.
test('the three harness-derived agent lists match their historical membership exactly', () => {
  assert.deepEqual(SUPPORTED_AGENTS, ['claude', 'codex', 'copilot']);
  assert.deepEqual(SUPPORTED_SKILL_AGENTS, ['claude', 'codex', 'copilot', 'cursor']);
  assert.deepEqual(LLM_AGENTS, ['claude', 'codex', 'copilot', 'cursor']);
});

test('agentsWithCapability derives the same three lists directly from the shared table', () => {
  assert.deepEqual(agentsWithCapability('mcpConfig'), SUPPORTED_AGENTS);
  assert.deepEqual(agentsWithCapability('skills'), SUPPORTED_SKILL_AGENTS);
  assert.deepEqual(agentsWithCapability('headlessInvocation'), LLM_AGENTS);
});

// docs/personas.md Phase 3: all four are confirmed native-subagent harnesses, verified against
// each one's official docs (see src/llm/harness.ts's HarnessCapabilities comment for the exact
// per-harness format/location and source). Pinned so a future edit can't silently narrow this back
// without a test failing.
test('nativeSubagents is true for all four supported agents', () => {
  assert.deepEqual(agentsWithCapability('nativeSubagents'), ['claude', 'codex', 'copilot', 'cursor']);
});

test('projectInstructions is true for all four supported agents (each has some plain instructions-file convention)', () => {
  assert.deepEqual(agentsWithCapability('projectInstructions'), ['claude', 'codex', 'copilot', 'cursor']);
});
