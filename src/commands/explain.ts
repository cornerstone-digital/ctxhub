import chalk from 'chalk';
import type { SearchResult } from '../config/types.js';
import { createContextPack } from '../context/pack.js';

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
};

export async function explainCommand(query: string, opts: { limit?: string; json?: boolean } = {}) {
  const result = await createExplainResult(query, Number(opts.limit ?? 8));

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printExplainResult(result);
}

export async function createExplainResult(query: string, limit = 8): Promise<ExplainResult> {
  const pack = await createContextPack(query, limit);
  const architecture = pack.architecture.slice(0, Math.min(4, limit));
  const context = pack.search.slice(0, limit);
  const evidence = assignEvidenceRefs(architecture, context);
  const stale = evidence.filter(item => item.stale);

  return {
    query,
    workspace: pack.workspace,
    generatedAt: new Date().toISOString(),
    answer: buildAnswerLines(evidence),
    evidence,
    citations: evidence.map(item => ({ ref: item.ref, repo: item.repo, path: item.path, title: item.title })),
    freshness: {
      staleCount: stale.length,
      notes: stale.map(item => `${item.ref} may be stale: ${item.repo}:${item.path}`)
    },
    suggestedReadingOrder: pack.suggestedReadingOrder
  };
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
  console.log(chalk.bold(`Explanation scaffold: ${result.query}`));
  console.log(chalk.gray(`Workspace: ${result.workspace} generated ${result.generatedAt}`));

  console.log(`\n${chalk.bold('Answer')}`);
  for (const line of result.answer) console.log(`- ${line}`);

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
