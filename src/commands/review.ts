import chalk from 'chalk';
import path from 'node:path';
import { CACHE_DIR, loadWorkspaceConfig } from '../config/config.js';
import type { CtxhubConfig } from '../config/types.js';
import { createContextPack } from '../context/pack.js';
import { createIndexProvider } from '../indexing/providers.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import { gatherRepoDiffs, reviewContractRisks } from './prContext.js';
import { analyzeArchitectureDrift, suggestDriftRepairs, type GraphPackage } from './graph.js';
import { llmDisabledNotice, runAgentPrompt } from '../llm/runAgent.js';
import { notify } from '../utils/notify.js';
import { buildPromptPreamble, loadPersona, loadPolicyText } from '../personas/persona.js';

type ContextPack = Awaited<ReturnType<typeof createContextPack>>;

// NEXT_FEATURES #28: a reviewer profile is data, not code. `kind` picks which existing engine
// answers it -- `contract`/`docs` reuse #13's contract-risk review and #14's drift-repair
// suggestions unmodified; `generic` is a freeform LLM persona defined entirely by its `focus`
// text. This is how a team adds "our API style guide reviewer" without a ctxhub code change:
// append a `kind: "generic"` entry to review-profiles.json.
// docs/personas.md Phase 2: `persona` optionally names a richer agents/personas/*.md file whose
// full body supplements `focus` in the assembled prompt -- only meaningful for `kind: "generic"`,
// since `contract`/`docs` don't build their prompt through buildReviewPrompt below at all.
export type ReviewerProfile = { name: string; kind: 'contract' | 'docs' | 'generic'; focus?: string; persona?: string };
export type ReviewerProfileSuite = { profiles: ReviewerProfile[] };

export const DEFAULT_REVIEW_PROFILES_PATH = path.join(CACHE_DIR, 'review-profiles.json');

// The exact 5 built-in personas from #27, now expressed as data instead of a hardcoded switch --
// #28's acceptance criteria requires built-ins to use the same profile shape as anything a team
// adds, not a separate mechanism.
export const DEFAULT_REVIEWER_PROFILES: ReviewerProfileSuite = {
  profiles: [
    {
      name: 'bug-hunter',
      kind: 'generic',
      focus: 'Look for concrete correctness bugs: logic errors, off-by-one mistakes, unhandled edge cases, incorrect error handling, or behavior that contradicts what the surrounding code/comments say it should do.'
    },
    { name: 'contract', kind: 'contract' },
    {
      name: 'security',
      kind: 'generic',
      focus: 'Look for concrete security issues: injection risks, missing input validation at trust boundaries, secrets/credential handling, authN/authZ gaps, or unsafe use of user-controlled data.'
    },
    {
      name: 'performance',
      kind: 'generic',
      focus: 'Look for concrete performance issues: unnecessary repeated work, N+1-style patterns, unbounded loops/allocations, or blocking operations that should be async/batched.'
    },
    { name: 'docs', kind: 'docs' }
  ]
};

// Seeds the file on first run, exactly like eval.ts's DEFAULT_AGENT_SUITE -- a reviewable,
// editable JSON file under .ctxhub/cache/, not a database.
export async function loadReviewerProfiles(filePath: string): Promise<ReviewerProfileSuite> {
  if (!(await pathExists(filePath))) {
    await writeText(filePath, JSON.stringify(DEFAULT_REVIEWER_PROFILES, null, 2));
  }
  return JSON.parse(await readText(filePath)) as ReviewerProfileSuite;
}

export type ReviewOptions = {
  as: string;
  base?: string;
  limit?: string;
  json?: boolean;
  llm?: boolean;
  profiles?: string;
  notify?: boolean;
};

export type ReviewResult = {
  topic: string;
  persona: string;
  changed: Map<string, string[]>;
  contextPack: ContextPack;
  findings: string[];
  llmNotice?: string;
};

// Extracted from reviewCommand so the Mission Control UI's review screen can reuse the exact same
// evidence-gathering/persona logic the CLI does -- `cwd` defaults to process.cwd() for the CLI
// path but the HTTP handler passes an explicit registered workspace path, same pattern as
// createExplainResult/createContextPack.
export async function createReviewResult(topic: string, opts: ReviewOptions, cwd = process.cwd()): Promise<ReviewResult> {
  const { config: loadedConfig, workspaceRoot } = await loadWorkspaceConfig(cwd);
  const config: CtxhubConfig = opts.llm === undefined ? loadedConfig : { ...loadedConfig, llm: { ...loadedConfig.llm, enabled: opts.llm } };
  const base = opts.base ?? 'origin/main';
  const pack = await createContextPack(topic, Number(opts.limit ?? 8), cwd);

  const profilesPath = opts.profiles ? path.resolve(cwd, opts.profiles) : path.resolve(workspaceRoot, DEFAULT_REVIEW_PROFILES_PATH);
  const suite = await loadReviewerProfiles(profilesPath);
  const profile = suite.profiles.find(candidate => candidate.name === opts.as);
  if (!profile) {
    const available = suite.profiles.map(candidate => candidate.name).join(', ');
    throw new Error(`Unknown review persona: ${opts.as}. Available personas: ${available} (edit ${path.relative(cwd, profilesPath)} to add more).`);
  }

  const { changed, findings, llmNotice } = await gatherPersonaFindings(profile, topic, config, workspaceRoot, base, pack);
  return { topic, persona: profile.name, changed, contextPack: pack, findings, ...(llmNotice ? { llmNotice } : {}) };
}

export async function reviewCommand(topic: string, opts: ReviewOptions) {
  const { changed, findings, llmNotice, persona, contextPack: pack } = await createReviewResult(topic, opts);

  if (opts.notify) notify('ctxhub review', `${persona}: ${findings.length} finding(s) for ${topic}`);

  if (opts.json) {
    console.log(JSON.stringify({ topic, persona, changed: Object.fromEntries(changed), contextPack: pack, findings, ...(llmNotice ? { llmNotice } : {}) }, null, 2));
    return;
  }

  console.log(chalk.bold(`Review (${persona}): ${topic}`));
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
  profile: ReviewerProfile,
  topic: string,
  config: CtxhubConfig,
  workspaceRoot: string,
  base: string,
  pack: ContextPack
): Promise<{ changed: Map<string, string[]>; findings: string[]; llmNotice?: string }> {
  if (profile.kind === 'docs') {
    return reviewDocsPersona(config, workspaceRoot);
  }

  const { changed, diffs } = await gatherRepoDiffs(config, workspaceRoot, base);

  if (profile.kind === 'contract') {
    const { risks, llmNotice } = await reviewContractRisks(changed, diffs, pack.repos.map(repo => repo.name), config);
    return { changed, findings: risks.map(risk => `${risk.repo}: ${risk.risk}`), llmNotice };
  }

  const policyText = await loadPolicyText(workspaceRoot);
  const persona = profile.persona ? await loadPersona(workspaceRoot, profile.persona) : undefined;
  const preamble = buildPromptPreamble(policyText, persona);

  const { findings, llmNotice } = await synthesizeReviewFindings(profile.name, profile.focus ?? '', topic, changed, diffs, pack, config, runAgentPrompt, preamble);
  return { changed, findings, llmNotice };
}

async function reviewDocsPersona(
  config: CtxhubConfig,
  workspaceRoot: string
): Promise<{ changed: Map<string, string[]>; findings: string[]; llmNotice?: string }> {
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);

  // Run the LanceDB search and all package.json reads in parallel — the serial loop
  // was the main cause of the "docs persona is slow on large workspaces" complaint.
  const [allResults, packageResults] = await Promise.all([
    index.search('architecture diagram mermaid', 100),
    Promise.all(
      config.repositories.map(async (repo): Promise<GraphPackage | null> => {
        const packagePath = path.resolve(workspaceRoot, repo.path, 'package.json');
        if (!(await pathExists(packagePath))) return null;
        const parsed = JSON.parse(await readText(packagePath)) as { name?: string; dependencies?: Record<string, string> };
        return { repo: repo.name, package: parsed.name, dependencies: Object.keys(parsed.dependencies ?? {}) };
      })
    )
  ]);

  const diagrams = allResults.filter(result => result.kind === 'architecture-diagram');
  const packages: GraphPackage[] = packageResults.filter((p): p is GraphPackage => p !== null);

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

export async function synthesizeReviewFindings(
  personaName: string,
  focus: string,
  topic: string,
  changed: Map<string, string[]>,
  diffs: Map<string, string>,
  pack: ContextPack,
  config: CtxhubConfig,
  runAgentPromptFn: typeof runAgentPrompt = runAgentPrompt,
  preamble = ''
): Promise<{ findings: string[]; llmNotice?: string }> {
  if (!changed.size) return { findings: [] };

  if (!config.llm.enabled) {
    return { findings: [], llmNotice: llmDisabledNotice(`${personaName} review`) };
  }

  const result = await runAgentPromptFn(config, buildReviewPrompt(personaName, focus, topic, changed, diffs, pack, preamble));
  if (!result.ok) {
    return { findings: [], llmNotice: `${personaName} review was unavailable (${result.reason}); showing the changed files and evidence bundle only.` };
  }

  const findings = result.text
    .split('\n')
    .map(line => line.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);
  return { findings };
}

function buildReviewPrompt(
  personaName: string,
  focus: string,
  topic: string,
  changed: Map<string, string[]>,
  diffs: Map<string, string>,
  pack: ContextPack,
  preamble = ''
): string {
  const changedBlock = [...changed.entries()].map(([repo, files]) => `${repo}: ${files.join(', ')}`).join('\n');
  const diffBlock = [...diffs.entries()].map(([repo, diff]) => `--- ${repo} diff ---\n${diff}`).join('\n\n');
  const evidenceBlock = [...pack.architecture, ...pack.search]
    .slice(0, 10)
    .map(item => `- ${item.repo}:${item.filePath}${item.title ? ` (${item.title})` : ''}`)
    .join('\n');

  return preamble + [
    `You are a "${personaName}" reviewer looking at a code change on topic: ${topic}.`,
    focus || 'Look for concrete issues relevant to your persona name; do not invent generic filler feedback.',
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
