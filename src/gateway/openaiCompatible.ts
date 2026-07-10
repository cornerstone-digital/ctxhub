import type { RunAgentResult } from '../llm/runAgent.js';

// docs/control-plane.md Phase 7: one generic OpenAI-compatible adapter, per the brief's own
// priority order, covers OpenRouter, LiteLLM, Portkey, Ollama, and enterprise proxies through a
// single `baseUrl` -- rather than building a named adapter per provider. Uses Node's built-in
// `fetch` (no new dependency), the same "reuse platform/runtime primitives" bias as
// src/utils/notify.ts's shell-outs and src/service/server.ts's plain `http`.
export type OpenAiCompatibleGatewayConfig = {
  baseUrl: string;
  // Name of an environment variable holding the API key -- never the key itself in config, so a
  // workspace's ctxhub.yaml (which may be git-tracked) never carries a secret.
  apiKeyEnv?: string;
  model: string;
};

type FetchFn = typeof fetch;

export async function probeOpenAiCompatibleGateway(
  config: Pick<OpenAiCompatibleGatewayConfig, 'baseUrl' | 'apiKeyEnv'>,
  fetchFn: FetchFn = fetch
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetchFn(`${trimTrailingSlash(config.baseUrl)}/models`, { headers: authHeaders(config) });
    return res.ok ? { ok: true } : { ok: false, detail: `HTTP ${res.status}` };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

// Returns the same RunAgentResult shape every harness-CLI invocation already returns, so callers
// (src/execution/executionProfile.ts) don't need to branch on result shape, only on which
// function to call.
export async function runOpenAiCompatiblePrompt(
  config: OpenAiCompatibleGatewayConfig,
  prompt: string,
  timeoutMs: number,
  fetchFn: FetchFn = fetch
): Promise<RunAgentResult> {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(`${trimTrailingSlash(config.baseUrl)}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(config) },
      body: JSON.stringify({ model: config.model, messages: [{ role: 'user', content: prompt }] }),
      signal: controller.signal
    });

    if (!res.ok) {
      return { ok: false, reason: 'error', detail: `Gateway request failed: HTTP ${res.status} ${await res.text()}` };
    }

    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return { ok: false, reason: 'error', detail: 'Gateway response had no message content.' };
    }

    return { ok: true, text };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { ok: false, reason: 'timeout', detail: `Gateway request timed out after ${timeoutMs}ms` };
    }
    return { ok: false, reason: 'error', detail: error instanceof Error ? error.message : String(error) };
  } finally {
    clearTimeout(timeoutHandle);
  }
}

function authHeaders(config: { apiKeyEnv?: string }): Record<string, string> {
  if (!config.apiKeyEnv) return {};
  const key = process.env[config.apiKeyEnv];
  return key ? { Authorization: `Bearer ${key}` } : {};
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
