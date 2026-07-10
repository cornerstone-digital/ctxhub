import type { CtxhubConfig, ExecutionProfile } from '../config/types.js';
import { runAgentPrompt, type RunAgentResult } from '../llm/runAgent.js';
import { runOpenAiCompatiblePrompt } from '../gateway/openaiCompatible.js';

// docs/control-plane.md Phase 4: Execution Profiles are additive config, not a new engine --
// a named profile just says which harness/model a persona should run under when a workspace has
// more than one configured. Resolving one is intentionally this thin; the real behavior lives in
// how callers combine it with `runAgentPrompt`'s existing agent/model override (src/llm/runAgent.ts).
export function resolveExecutionProfile(config: CtxhubConfig, name: string): ExecutionProfile | undefined {
  return config.executionProfiles[name];
}

export type RunAgentPromptFn = (
  config: CtxhubConfig,
  prompt: string,
  opts?: { agent?: CtxhubConfig['llm']['agent']; model?: string }
) => Promise<RunAgentResult>;

// docs/control-plane.md Phase 7: a profile with `runtime: 'direct-api'` skips harness CLIs
// entirely, calling its configured gateway instead. Returned as a function matching
// runAgentPrompt's own call signature so callers (explain.ts, captains/runner.ts) don't need to
// branch on which path they're on, only on which function to call once, up front.
export function runAgentPromptFnForProfile(profile: ExecutionProfile | undefined): RunAgentPromptFn {
  if (profile?.runtime !== 'direct-api') return runAgentPrompt;

  const gateway = profile.gateway;
  const model = profile.model;
  return async (config, prompt) => {
    if (!config.llm.enabled) return { ok: false, reason: 'disabled' };
    if (!gateway) return { ok: false, reason: 'error', detail: 'Execution profile with runtime "direct-api" must set a gateway.' };
    if (!model) return { ok: false, reason: 'error', detail: 'Execution profile with runtime "direct-api" must set a model.' };

    return runOpenAiCompatiblePrompt({ baseUrl: gateway.baseUrl, apiKeyEnv: gateway.apiKeyEnv, model }, prompt, config.llm.timeoutMs);
  };
}
