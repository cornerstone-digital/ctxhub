import type { LlmAgentName } from '../config/types.js';

export type HarnessCapabilities = {
  // Can ctxhub write/merge this agent's MCP config file (`ctxhub agent <name>`)?
  mcpConfig: boolean;
  // Can `ctxhub skills install` place skill files for this agent?
  skills: boolean;
  // Can `runAgentPrompt` invoke this agent headlessly for LLM-backed features?
  headlessInvocation: boolean;
  // docs/personas.md Phase 3: does this harness have a distinct, file-defined sub-agent it can
  // delegate to on its own (not just a skill/instructions file it reads for its own single-context
  // turn)? Only Claude Code is confirmed as of this writing (`.claude/agents/<name>.md`, a real,
  // documented feature with its own frontmatter schema). The other three are deliberately kept
  // false rather than assumed true -- flip only after confirming against that harness's own
  // current docs, per the explicit decision in docs/personas.md's Phase 3 section.
  nativeSubagents: boolean;
  // A plain project-level instructions file the harness reads for general guidance -- the compile
  // target for personas.ts's `ctxhub personas sync` when nativeSubagents is false.
  projectInstructions: boolean;
};

// NEXT_FEATURES #29: one table modeling what "supporting a harness" actually means, instead of
// three independently-maintained lists (agent.ts's SUPPORTED_AGENTS, skills.ts's
// SUPPORTED_SKILL_AGENTS, runAgent.ts's LLM_AGENTS) that happened to almost-but-not-quite agree.
// This is a pure consolidation -- membership below is unchanged from what those three lists
// already encoded, including the real, pre-existing gap it now makes visible in one place: cursor
// has no MCP-config-writing support yet, so `mcpConfig` is false for it alone.
export const AGENT_CAPABILITIES = {
  claude: { mcpConfig: true, skills: true, headlessInvocation: true, nativeSubagents: true, projectInstructions: true },
  codex: { mcpConfig: true, skills: true, headlessInvocation: true, nativeSubagents: false, projectInstructions: true },
  copilot: { mcpConfig: true, skills: true, headlessInvocation: true, nativeSubagents: false, projectInstructions: true },
  cursor: { mcpConfig: false, skills: true, headlessInvocation: true, nativeSubagents: false, projectInstructions: true }
} as const satisfies Record<LlmAgentName, HarnessCapabilities>;

export type AgentsWithCapability<K extends keyof HarnessCapabilities> = {
  [A in keyof typeof AGENT_CAPABILITIES]: (typeof AGENT_CAPABILITIES)[A][K] extends true ? A : never;
}[keyof typeof AGENT_CAPABILITIES];

// A type-predicate filter (rather than a plain boolean-returning one) so `Array.prototype.filter`
// narrows the resulting array's element type at compile time, not just its runtime contents --
// this is what lets each consuming module's exported list keep its historical narrow literal
// type (e.g. excluding "cursor") while still being computed from this one shared table.
export function isCapableOf<K extends keyof HarnessCapabilities>(capability: K) {
  return (agent: LlmAgentName): agent is Extract<LlmAgentName, AgentsWithCapability<K>> =>
    AGENT_CAPABILITIES[agent][capability] === true;
}

export function agentsWithCapability<K extends keyof HarnessCapabilities>(capability: K): AgentsWithCapability<K>[] {
  return (Object.keys(AGENT_CAPABILITIES) as LlmAgentName[]).filter(isCapableOf(capability));
}
