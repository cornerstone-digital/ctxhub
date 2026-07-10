import chalk from 'chalk';
import type { CtxhubConfig, SearchResult } from '../config/types.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { createContextPack } from '../context/pack.js';
import { llmDisabledNotice, runAgentPrompt, type RunAgentResult } from '../llm/runAgent.js';

export type ExplainEvidence = {
  ref: string;
  repo: string;
  path: string;
  title?: string;
  snippet: string;
  stale: boolean;
  kind: 'architecture' | 'context';
};

export type ExplainResult = {
  query: string;
  workspace: string;
  generatedAt: string;
  answer: string[];
  evidence: ExplainEvidence[];
  citations: Array<{ ref: string; repo: string; path: string; title?: string }>;
  freshness: {
    staleCount: number;
    notes: string[];
  };
  suggestedReadingOrder: Array<{ repo: string; path: string; title?: string }>;
  // Present only when LLM synthesis was skipped or failed (disabled, no agent, timeout, error) --
  // absent entirely when synthesis succeeded or was never attempted (no evidence to synthesize from).
  llmNotice?: string;
};

export async function explainCommand(query: string, opts: { limit?: string; json?: boolean; llm?: boolean } = {}) {
  const result = await createExplainResult(query, Number(opts.limit ?? 8), process.cwd(), { llmOverride: opts.llm });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printExplainResult(result);
}

export async function createExplainResult(
  query: string,
  limit = 8,
  cwd = process.cwd(),
  opts: { llmOverride?: boolean; runAgentPromptFn?: typeof runAgentPrompt } = {}
): Promise<ExplainResult> {
  const pack = await createContextPack(query, limit, cwd);
  const architecture = pack.architecture.slice(0, Math.min(4, limit));
  const context = pack.search.slice(0, limit);
  const evidence = assignEvidenceRefs(architecture, context);
  const stale = evidence.filter(item => item.stale);

  const { config } = await loadWorkspaceConfig(cwd);
  // A CLI --llm/--no-llm flag only overrides this one call; `config.llm.enabled` remains the
  // authority for every caller that doesn't pass an explicit override (opt-in stays config-level).
  const effectiveConfig: CtxhubConfig =
    opts.llmOverride === undefined ? config : { ...config, llm: { ...config.llm, enabled: opts.llmOverride } };

  const { answer, llmNotice } = await resolveAnswer(query, evidence, effectiveConfig, opts.runAgentPromptFn ?? runAgentPrompt);

  return {
    query,
    workspace: pack.workspace,
    generatedAt: new Date().toISOString(),
    answer,
    evidence,
    citations: evidence.map(item => ({ ref: item.ref, repo: item.repo, path: item.path, title: item.title })),
    freshness: {
      staleCount: stale.length,
      notes: stale.map(item => `${item.ref} may be stale: ${item.repo}:${item.path}`)
    },
    suggestedReadingOrder: pack.suggestedReadingOrder,
    ...(llmNotice ? { llmNotice } : {})
  };
}

async function resolveAnswer(
  query: string,
  evidence: ExplainEvidence[],
  config: CtxhubConfig,
  runAgentPromptFn: (config: CtxhubConfig, prompt: string) => Promise<RunAgentResult>
): Promise<{ answer: string[]; llmNotice?: string }> {
  if (!evidence.length) {
    return { answer: buildAnswerLines(evidence) };
  }

  const result = await runAgentPromptFn(config, buildLlmPrompt(query, evidence));
  if (result.ok) {
    const lines = result.text.split('\n').map(line => line.trim()).filter(Boolean);
    return { answer: lines.length ? lines : buildAnswerLines(evidence) };
  }

  const llmNotice =
    result.reason === 'disabled'
      ? llmDisabledNotice('answer synthesis')
      : `LLM-backed answer synthesis was unavailable (${result.reason}); showing the evidence scaffold instead.`;

  return { answer: buildAnswerLines(evidence), llmNotice };
}

function buildLlmPrompt(query: string, evidence: ExplainEvidence[]): string {
  const evidenceBlock = evidence
    .map(item => `[${item.ref}] ${item.repo}:${item.path}${item.title ? ` (${item.title})` : ''}\n${item.snippet}`)
    .join('\n\n');

  return [
    `Question: ${query}`,
    '',
    'Evidence (cite only these refs by their exact [ref] label; never invent a citation or reference anything not listed here):',
    evidenceBlock,
    '',
    'Write a concise, direct answer to the question using only the evidence above, citing each claim inline with its [ref]. ' +
      'If the evidence does not actually answer the question, say so plainly instead of guessing.'
  ].join('\n');
}

export function buildAnswerLines(evidence: ExplainEvidence[]): string[] {
  if (!evidence.length) {
    return ['No indexed evidence matched this query. Run ctxhub index or broaden the query.'];
  }

  const architectureRefs = evidence.filter(item => item.kind === 'architecture').map(item => item.ref);
  const contextRefs = evidence.filter(item => item.kind === 'context').map(item => item.ref);
  const lines = [];

  if (architectureRefs.length) {
    lines.push(`Architecture evidence is available in ${formatRefs(architectureRefs)}.`);
  }
  if (contextRefs.length) {
    lines.push(`Grounding source/doc evidence is available in ${formatRefs(contextRefs)}.`);
  }
  lines.push('Use the citations below as the source of truth; this command summarizes retrieved evidence only.');
  return lines;
}

function assignEvidenceRefs(architecture: SearchResult[], context: SearchResult[]): ExplainEvidence[] {
  const seen = new Set<string>();
  const items: ExplainEvidence[] = [];

  for (const result of architecture) {
    const key = `${result.repo}:${result.filePath}:${result.title ?? ''}:architecture`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(toEvidence(result, 'architecture', items.length + 1));
  }

  for (const result of context) {
    const key = `${result.repo}:${result.filePath}:${result.title ?? ''}:context`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(toEvidence(result, 'context', items.length + 1));
  }

  return items;
}

function toEvidence(result: SearchResult, kind: ExplainEvidence['kind'], index: number): ExplainEvidence {
  return {
    ref: `E${index}`,
    repo: result.repo,
    path: result.filePath,
    title: result.title,
    snippet: result.snippet,
    stale: Boolean(result.freshness?.stale),
    kind
  };
}

function printExplainResult(result: ExplainResult): void {
  console.log(chalk.bold(`Explanation: ${result.query}`));
  console.log(chalk.gray(`Workspace: ${result.workspace} generated ${result.generatedAt}`));

  console.log(`\n${chalk.bold('Answer')}`);
  for (const line of result.answer) console.log(`- ${line}`);
  if (result.llmNotice) console.log(chalk.dim(result.llmNotice));

  if (result.freshness.staleCount) {
    console.log(`\n${chalk.bold('Freshness')}`);
    for (const note of result.freshness.notes) console.log(`${chalk.yellow('!')} ${note}`);
  }

  console.log(`\n${chalk.bold('Evidence')}`);
  for (const item of result.evidence) {
    const stale = item.stale ? chalk.yellow(' stale') : '';
    console.log(`[${item.ref}] ${chalk.green(item.repo)} ${chalk.gray(item.path)}${stale}`);
    if (item.title) console.log(chalk.bold(item.title));
    console.log(item.snippet);
  }

  console.log(`\n${chalk.bold('Suggested Reading Order')}`);
  for (const item of result.suggestedReadingOrder) {
    console.log(`- ${item.repo}:${item.path}${item.title ? ` - ${item.title}` : ''}`);
  }
}

function formatRefs(refs: string[]): string {
  return refs.map(ref => `[${ref}]`).join(', ');
}
