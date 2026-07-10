import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import type { CtxhubConfig } from '../config/types.js';
import { createContextPack } from '../context/pack.js';
import { createIndexProvider } from '../indexing/providers.js';
import { pathExists, readText } from '../utils/fs.js';
import path from 'node:path';
import { gatherRepoDiffs, reviewContractRisks } from './prContext.js';
import { analyzeArchitectureDrift, suggestDriftRepairs, type GraphPackage } from './graph.js';
import { llmDisabledNotice, runAgentPrompt } from '../llm/runAgent.js';

// NEXT_FEATURES #27: five built-in reviewer personas, all orchestrating existing primitives
// rather than a new evidence engine. #28 will replace this hardcoded map with loadable profiles;
// this hardcoded version is the deliberate, explicitly-scoped-out first step.
export const REVIEW_PERSONAS = ['bug-hunter', 'contract', 'security', 'performance', 'docs'] as const;
export type ReviewPersona = typeof REVIEW_PERSONAS[number];

type ContextPack = Awaited<ReturnType<typeof createContextPack>>;

export type ReviewOptions = {
  as: ReviewPersona;
  base?: string;
  limit?: string;
  json?: boolean;
  llm?: boolean;
};

export async function reviewCommand(topic: string, opts: ReviewOptions) {
  const { config: loadedConfig, workspaceRoot } = await loadWorkspaceConfig();
  const config: CtxhubConfig = opts.llm === undefined ? loadedConfig : { ...loadedConfig, llm: { ...loadedConfig.llm, enabled: opts.llm } };
  const base = opts.base ?? 'origin/main';
  const pack = await createContextPack(topic, Number(opts.limit ?? 8));

  const { changed, findings, llmNotice } = await gatherPersonaFindings(opts.as, topic, config, workspaceRoot, base, pack);

  const payload = {
    topic,
    persona: opts.as,
    changed: Object.fromEntries(changed),
    contextPack: pack,
    findings,
    ...(llmNotice ? { llmNotice } : {})
  };

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(chalk.bold(`Review (${opts.as}): ${topic}`));
  for (const [repo, files] of changed) {
    console.log(`\n${chalk.green(repo)}`);
    for (const file of files) console.log(`- ${file}`);
  }

  console.log(`\n${chalk.bold('Suggested context')}`);
  for (const item of pack.suggestedReadingOrder) console.log(`${item.repo} ${item.path}${item.title ? ` - ${item.title}` : ''}`);

  if (findings.length) {
    console.log(`\n${chalk.bold.yellow('Findings')}`);
    for (const finding of findings) console.log(`${chalk.yellow('!')} ${finding}`);
  } else {
    console.log(`\n${chalk.gray('No findings.')}`);
  }
  if (llmNotice) console.log(chalk.dim(`\n${llmNotice}`));
}

async function gatherPersonaFindings(
  persona: ReviewPersona,
  topic: string,
  config: CtxhubConfig,
  workspaceRoot: string,
  base: string,
  pack: ContextPack
): Promise<{ changed: Map<string, string[]>; findings: string[]; llmNotice?: string }> {
  if (!REVIEW_PERSONAS.includes(persona)) {
    throw new Error(`Unknown review persona: ${persona}. Valid personas: ${REVIEW_PERSONAS.join(', ')}`);
  }

  if (persona === 'docs') {
    return reviewDocsPersona(config, workspaceRoot);
  }

  const { changed, diffs } = await gatherRepoDiffs(config, workspaceRoot, base);

  if (persona === 'contract') {
    const { risks, llmNotice } = await reviewContractRisks(changed, diffs, pack.repos.map(repo => repo.name), config);
    return { changed, findings: risks.map(risk => `${risk.repo}: ${risk.risk}`), llmNotice };
  }

  const { findings, llmNotice } = await synthesizeReviewFindings(persona, topic, changed, diffs, pack, config);
  return { changed, findings, llmNotice };
}

async function reviewDocsPersona(
  config: CtxhubConfig,
  workspaceRoot: string
): Promise<{ changed: Map<string, string[]>; findings: string[]; llmNotice?: string }> {
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const diagrams = (await index.search('architecture diagram mermaid', 100)).filter(result => result.kind === 'architecture-diagram');
  const packages: GraphPackage[] = [];
  for (const repo of config.repositories) {
    const packagePath = path.resolve(workspaceRoot, repo.path, 'package.json');
    if (await pathExists(packagePath)) {
      const parsed = JSON.parse(await readText(packagePath)) as { name?: string; dependencies?: Record<string, string> };
      packages.push({ repo: repo.name, package: parsed.name, dependencies: Object.keys(parsed.dependencies ?? {}) });
    }
  }

  const drift = analyzeArchitectureDrift({
    repos: config.repositories,
    components: [...new Set(diagrams.flatMap(result => result.components ?? []))],
    relationships: [...new Set(diagrams.flatMap(result => result.relationships ?? []))],
    diagrams: diagrams.map(result => ({ repo: result.repo, path: result.filePath, type: result.diagramType })),
    packages
  });

  const repair = drift.length ? await suggestDriftRepairs(diagrams, drift, config) : { suggestions: [] as Awaited<ReturnType<typeof suggestDriftRepairs>>['suggestions'] };
  const findings = [
    ...drift.map(finding => finding.message),
    ...repair.suggestions.map(suggestion => `${suggestion.repo}:${suggestion.path} -- ${suggestion.note}`)
  ];

  return { changed: new Map(), findings, llmNotice: repair.llmNotice };
}

const PERSONA_FOCUS: Record<'bug-hunter' | 'security' | 'performance', string> = {
  'bug-hunter': 'Look for concrete correctness bugs: logic errors, off-by-one mistakes, unhandled edge cases, incorrect error handling, or behavior that contradicts what the surrounding code/comments say it should do.',
  security: 'Look for concrete security issues: injection risks, missing input validation at trust boundaries, secrets/credential handling, authN/authZ gaps, or unsafe use of user-controlled data.',
  performance: 'Look for concrete performance issues: unnecessary repeated work, N+1-style patterns, unbounded loops/allocations, or blocking operations that should be async/batched.'
};

export async function synthesizeReviewFindings(
  persona: 'bug-hunter' | 'security' | 'performance',
  topic: string,
  changed: Map<string, string[]>,
  diffs: Map<string, string>,
  pack: ContextPack,
  config: CtxhubConfig,
  runAgentPromptFn: typeof runAgentPrompt = runAgentPrompt
): Promise<{ findings: string[]; llmNotice?: string }> {
  if (!changed.size) return { findings: [] };

  if (!config.llm.enabled) {
    return { findings: [], llmNotice: llmDisabledNotice(`${persona} review`) };
  }

  const result = await runAgentPromptFn(config, buildReviewPrompt(persona, topic, changed, diffs, pack));
  if (!result.ok) {
    return { findings: [], llmNotice: `${persona} review was unavailable (${result.reason}); showing the changed files and evidence bundle only.` };
  }

  const findings = result.text
    .split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  return { findings };
}

function buildReviewPrompt(
  persona: 'bug-hunter' | 'security' | 'performance',
  topic: string,
  changed: Map<string, string[]>,
  diffs: Map<string, string>,
  pack: ContextPack
): string {
  const changedBlock = [...changed.entries()].map(([repo, files]) => `${repo}: ${files.join(', ')}`).join('\n');
  const diffBlock = [...diffs.entries()].map(([repo, diff]) => `--- ${repo} diff ---\n${diff}`).join('\n\n');
  const evidenceBlock = [...pack.architecture, ...pack.search]
    .slice(0, 10)
    .map(item => `- ${item.repo}:${item.filePath}${item.title ? ` (${item.title})` : ''}`)
    .join('\n');

  return [
    `You are a ${persona.replace('-', ' ')} reviewing a code change on topic: ${topic}.`,
    PERSONA_FOCUS[persona],
    '',
    `Changed files:\n${changedBlock || '(none found vs the requested base)'}`,
    '',
    `Diff (may be truncated):\n${diffBlock || '(no diff content available)'}`,
    '',
    `Indexed evidence (cite only these repo:path pairs when relevant, never invent one):\n${evidenceBlock || '(none found)'}`,
    '',
    'Output one finding per line, each starting with "- ". Cite repo:path for specific claims when possible. ' +
      'If you find nothing concrete for this persona, output nothing rather than inventing a finding.'
  ].join('\n');
}
