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
  // turn)? All four are confirmed true as of this writing, each with a real, documented, but
  // genuinely different file format/location -- verified against each harness's own official docs
  // (see personas.ts's per-harness compile functions for the exact schemas and sources):
  //   claude:  .claude/agents/<name>.md         -- YAML frontmatter (name, description, tools?, model?)
  //   codex:   .codex/agents/<name>.toml        -- TOML (name, description, developer_instructions)
  //   copilot: .github/agents/<name>.agent.md   -- YAML frontmatter (description required; name, tools?, model? optional)
  //   cursor:  .cursor/agents/<name>.md         -- YAML frontmatter (name, description, model?)
  // This was previously (incorrectly) assumed false for everyone but Claude, based on this
  // codebase's own knowledge cutoff predating all three other harnesses shipping this feature.
  nativeSubagents: boolean;
  // A plain project-level instructions file the harness reads for general guidance, distinct from
  // a native subagent -- not currently used as a compile target now that all four have real
  // native subagent support, but kept as a documented, real capability in its own right.
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
  codex: { mcpConfig: true, skills: true, headlessInvocation: true, nativeSubagents: true, projectInstructions: true },
  copilot: { mcpConfig: true, skills: true, headlessInvocation: true, nativeSubagents: true, projectInstructions: true },
  cursor: { mcpConfig: false, skills: true, headlessInvocation: true, nativeSubagents: true, projectInstructions: true }
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
