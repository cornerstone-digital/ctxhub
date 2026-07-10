import type { CtxhubConfig, ExecutionProfile } from '../config/types.js';

// docs/control-plane.md Phase 4: Execution Profiles are additive config, not a new engine --
// a named profile just says which harness/model a persona should run under when a workspace has
// more than one configured. Resolving one is intentionally this thin; the real behavior lives in
// how callers combine it with `runAgentPrompt`'s existing agent/model override (src/llm/runAgent.ts).
export function resolveExecutionProfile(config: CtxhubConfig, name: string): ExecutionProfile | undefined {
  return config.executionProfiles[name];
}
