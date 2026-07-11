import path from 'node:path';
import chalk from 'chalk';
import { CACHE_DIR, loadWorkspaceConfig } from '../config/config.js';
import type { CtxhubConfig, SearchResult } from '../config/types.js';
import { createIndexProvider } from '../indexing/providers.js';
import { loadManifest } from '../indexing/manifest.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import { shouldUseInteractive } from '../utils/interactive.js';
import { llmDisabledNotice, runAgentPrompt } from '../llm/runAgent.js';
import { notify } from '../utils/notify.js';
import { buildPromptPreamble, loadPolicyText } from '../personas/persona.js';

export type EvalExpected = { repo?: string; path?: string };
export type EvalCase = { query: string; expected: EvalExpected[]; rationale?: string };
export type EvalSuite = { cases: EvalCase[] };
export type EvalExpectedResult = EvalExpected & { rank?: number; score?: number; matchedPath?: string; matchedRepo?: string };
export type EvalCaseResult = {
  query: string;
  rationale?: string;
  passed: boolean;
  expected: EvalExpectedResult[];
  missing: EvalExpected[];
  topResults: Array<{ repo: string; path: string; title?: string; score: number }>;
};
export type EvalRunResult = {
  generatedAt: string;
  suitePath: string;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  cases: EvalCaseResult[];
};

type SearchFn = (query: string, limit: number) => Promise<SearchResult[]>;

const DEFAULT_EVAL_PATH = path.join(CACHE_DIR, 'eval.json');
const EVAL_RUNS_DIR = path.join(CACHE_DIR, 'evals');
const DEFAULT_AGENT_EVAL_PATH = path.join(CACHE_DIR, 'agent-eval.json');

// Workspace-agnostic health checks: queries broad enough to return results in any non-trivial
// indexed codebase. Pass condition is just "at least one result returned" -- these confirm the
// index is working and has content, not that specific files score highly. Run with --health.
export const HEALTH_EVAL_SUITE: EvalSuite = {
  cases: [
    {
      query: 'how does this project work',
      expected: [{}],
      rationale: 'Any indexed workspace should return context for a broad project question'
    },
    {
      query: 'function class implementation',
      expected: [{}],
      rationale: 'Any codebase with source files should return code results'
    },
    {
      query: 'installation setup usage',
      expected: [{}],
      rationale: 'Any project with documentation should return README or guide content'
    },
    {
      query: 'configuration options',
      expected: [{}],
      rationale: 'Any workspace with config files or docs should return configuration content'
    },
    {
      query: 'error handling',
      expected: [{}],
      rationale: 'Any non-trivial codebase should contain error handling patterns'
    }
  ]
};

// Starter suite written by --init: more useful than a single placeholder, but still intentionally
// generic so users see the format and understand what to customise. Expected paths are left empty
// so the cases pass on first run (giving a baseline to worsen from) -- users should fill in
// specific expected file paths once they've explored what their index actually contains.
const INIT_EVAL_SUITE: EvalSuite = {
  cases: [
    {
      query: 'authentication flow',
      expected: [{}],
      rationale: 'How authentication works in this project'
    },
    {
      query: 'error handling patterns',
      expected: [{}],
      rationale: 'Common error handling approach'
    },
    {
      query: 'data model schema types',
      expected: [{}],
      rationale: 'Core data structures and types'
    },
    {
      query: 'API endpoints routes',
      expected: [{}],
      rationale: 'HTTP API or interface surface'
    },
    {
      query: 'configuration options setup',
      expected: [{}],
      rationale: 'How to configure this project'
    }
  ]
};

export async function evalCommand(
  opts: { file?: string; init?: boolean; json?: boolean; report?: boolean; plain?: boolean; interactive?: boolean; agentReport?: boolean; suggestQueries?: boolean; notify?: boolean; health?: boolean } = {}
) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();

  if (opts.agentReport) {
    await runAgentEvalReport(config, workspaceRoot, opts);
    return;
  }

  if (opts.health) {
    await runHealthEval(config, workspaceRoot, opts);
    return;
  }

  const filePath = opts.file ? path.resolve(process.cwd(), opts.file) : path.resolve(workspaceRoot, DEFAULT_EVAL_PATH);
  if (opts.init || !(await pathExists(filePath))) {
    await writeText(filePath, JSON.stringify(INIT_EVAL_SUITE, null, 2));
    console.log(chalk.green(`Created ${path.relative(process.cwd(), filePath)}`));
    if (!opts.init) {
      console.log(chalk.gray('Starter queries created. Run ctxhub eval to see what your index returns,'));
      console.log(chalk.gray('then edit the file to add expected file paths for the results you care about.'));
      console.log(chalk.gray('Run ctxhub eval --suggest-queries to expand the suite with LLM-suggested cases.'));
    }
    return;
  }

  const suite = JSON.parse(await readText(filePath)) as EvalSuite;

  if (opts.suggestQueries) {
    const { suggestions, llmNotice } = await suggestEvalQueries(suite, config, workspaceRoot);
    const { suite: nextSuite, added } = appendSuggestedEvalCases(suite, suggestions);

    if (added.length) {
      await writeText(filePath, JSON.stringify(nextSuite, null, 2));
    }

    if (opts.json) {
      console.log(JSON.stringify({ filePath, added, totalCases: nextSuite.cases.length, llmNotice }, null, 2));
      return;
    }

    if (added.length) {
      console.log(chalk.green(`Appended ${added.length} suggested eval case${added.length === 1 ? '' : 's'} to ${path.relative(process.cwd(), filePath)}`));
      for (const testCase of added) {
        console.log(`${chalk.green('+')} ${testCase.query}`);
        if (testCase.rationale) console.log(chalk.gray(`  why: ${testCase.rationale}`));
      }
    } else {
      console.log(chalk.yellow('No new eval query suggestions were appended.'));
    }
    if (llmNotice) console.log(chalk.dim(llmNotice));
    if (opts.notify) notify('ctxhub eval', `${added.length} suggested query/queries appended`);
    return;
  }

  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const run = await evaluateSuite(suite, (query, limit) => index.search(query, limit), filePath);
  const historyPath = await writeEvalHistory(run, workspaceRoot);
  const reportPath = opts.report ? await writeEvalReport(run, workspaceRoot) : undefined;

  if (opts.json) {
    console.log(JSON.stringify({ ...run, historyPath, reportPath }, null, 2));
    if (run.summary.failed) process.exitCode = 1;
    return;
  }

  if (shouldUseInteractive(opts)) {
    printEvalSummary(run, historyPath, reportPath);
  } else if (opts.report && reportPath) {
    console.log(chalk.green(`Wrote eval report: ${path.relative(process.cwd(), reportPath)}`));
  }

  printEvalRun(run);
  if (run.summary.failed) process.exitCode = 1;
}

// --- Health eval (--health) ---
//
// Workspace-agnostic smoke test: runs the HEALTH_EVAL_SUITE of broad queries and checks that
// each returns at least one result. Fails loudly if the index looks empty or unhealthy.
// Intended as the first thing a new user runs after `ctxhub index` to confirm things are working.

async function runHealthEval(
  config: CtxhubConfig,
  workspaceRoot: string,
  opts: { json?: boolean; notify?: boolean }
): Promise<void> {
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const run = await evaluateSuite(HEALTH_EVAL_SUITE, (query, limit) => index.search(query, limit), 'builtin:health');

  if (opts.json) {
    console.log(JSON.stringify(run, null, 2));
    if (run.summary.failed) process.exitCode = 1;
    return;
  }

  const allPassed = run.summary.failed === 0;
  console.log(chalk.bold('ctxhub index health check'));
  console.log(allPassed ? chalk.green(`✓ ${run.summary.passed}/${run.summary.total} queries returned results`) : chalk.red(`✗ ${run.summary.failed}/${run.summary.total} queries returned no results`));

  for (const testCase of run.cases) {
    const icon = testCase.passed ? chalk.green('✓') : chalk.red('✗');
    const detail = testCase.passed
      ? chalk.gray(`${testCase.topResults.length} result${testCase.topResults.length === 1 ? '' : 's'}, top: ${testCase.topResults[0]?.repo}:${testCase.topResults[0]?.path}`)
      : chalk.red('no results — index may be empty or query not covered');
    console.log(`  ${icon} ${testCase.query}  ${detail}`);
  }

  if (!allPassed) {
    console.log('');
    console.log(chalk.yellow('Some queries returned no results. Try:'));
    console.log(chalk.gray('  ctxhub index          — ensure the workspace is indexed'));
    console.log(chalk.gray('  ctxhub doctor         — check for configuration issues'));
    console.log(chalk.gray('  ctxhub repo list      — verify repositories are registered'));
    process.exitCode = 1;
  } else {
    console.log('');
    console.log(chalk.gray('Index is healthy. Run ctxhub eval to measure search quality against your suite.'));
  }

  if (opts.notify) notify('ctxhub eval', `Health: ${run.summary.passed}/${run.summary.total} passed`);
}

// --- Agent tool-choice report (--agent-report) ---
//
// Distinct from the search-quality eval above: instead of checking whether the index returns
// the right file for a query, this checks whether an agent given ctxhub's tool descriptions
// reaches for the tool the skill docs actually recommend for a realistic question. Formalizes
// the manual version of this we did by hand against a real workspace this session, which kept
// finding genuine skill/doc gaps.

export type AgentEvalCase = { question: string; expectedTool: string };
export type AgentEvalSuite = { cases: AgentEvalCase[] };
export type AgentEvalCaseResult = { question: string; expectedTool: string; agentAnswer?: string; matched: boolean; error?: string };
export type AgentEvalRunResult = {
  generatedAt: string;
  summary: { total: number; matched: number; unmatched: number };
  cases: AgentEvalCaseResult[];
};

// Seeded from the ctxhub skill's own documented tool guidance, not arbitrary choices -- these
// are the exact scenarios its "How to use it" section describes, so a mismatch here means the
// agent and the skill doc actually disagree about what to reach for.
const DEFAULT_AGENT_SUITE: AgentEvalSuite = {
  cases: [
    { question: 'How does the billing service authenticate with the payments service?', expectedTool: 'context_pack' },
    { question: 'How does this system fit together end to end?', expectedTool: 'architecture_search' },
    { question: 'Where is the rate limiting logic implemented?', expectedTool: 'search' }
  ]
};

const TOOL_PRIMER = [
  'You have access to the following ctxhub tools for a multi-repo workspace:',
  '- context_pack(query): bundles search hits, architecture hits, freshness, and repo list. Default first stop for broad questions.',
  '- search(query, type): search docs/code across all repos. type can be docs, code, architecture, or notes.',
  '- architecture_search(query) / architecture_map(): find Mermaid diagrams and system topology for "how does this fit together" questions.',
  '- repo_list(): list configured repositories.',
  '- get_file_context / open_chunk: exact source/doc lookup after an initial search.',
  '',
  'Given the question below, reply with ONLY the name of the single tool you would call first -- no explanation, no punctuation.'
].join('\n');

async function runAgentEvalReport(
  config: CtxhubConfig,
  workspaceRoot: string,
  opts: { file?: string; json?: boolean; notify?: boolean }
): Promise<void> {
  if (!config.llm.enabled) {
    console.log(llmDisabledNotice('agent tool-choice reports'));
    return;
  }

  const filePath = opts.file ? path.resolve(process.cwd(), opts.file) : path.resolve(workspaceRoot, DEFAULT_AGENT_EVAL_PATH);
  if (!(await pathExists(filePath))) {
    await writeText(filePath, JSON.stringify(DEFAULT_AGENT_SUITE, null, 2));
    console.log(chalk.green(`Created ${path.relative(process.cwd(), filePath)}`));
  }

  const suite = JSON.parse(await readText(filePath)) as AgentEvalSuite;
  const run = await evaluateAgentSuite(suite, config);
  const reportPath = await writeAgentEvalReport(run, workspaceRoot);

  if (opts.notify) notify('ctxhub eval', `Agent tool-choice report: ${run.summary.matched}/${run.summary.total} matched`);

  if (opts.json) {
    console.log(JSON.stringify({ ...run, reportPath }, null, 2));
    if (run.summary.unmatched) process.exitCode = 1;
    return;
  }

  console.log(chalk.bold('ctxhub agent tool-choice report'));
  const color = run.summary.unmatched ? chalk.yellow : chalk.green;
  console.log(color(`${run.summary.matched}/${run.summary.total} matched expected tool`));
  console.log(chalk.gray(`Report: ${path.relative(process.cwd(), reportPath)}`));
  for (const testCase of run.cases) {
    if (testCase.error) {
      console.log(`${chalk.yellow('•')} ${testCase.question} -- skipped (${testCase.error})`);
    } else {
      console.log(`${testCase.matched ? chalk.green('✓') : chalk.red('✗')} ${testCase.question} -- expected ${testCase.expectedTool}, got "${testCase.agentAnswer}"`);
    }
  }
  if (run.summary.unmatched) process.exitCode = 1;
}

export async function evaluateAgentSuite(
  suite: AgentEvalSuite,
  config: CtxhubConfig,
  runAgentPromptFn: typeof runAgentPrompt = runAgentPrompt
): Promise<AgentEvalRunResult> {
  const cases: AgentEvalCaseResult[] = [];

  for (const testCase of suite.cases) {
    const prompt = `${TOOL_PRIMER}\n\nQuestion: ${testCase.question}`;
    const result = await runAgentPromptFn(config, prompt);

    if (!result.ok) {
      cases.push({ question: testCase.question, expectedTool: testCase.expectedTool, matched: false, error: result.reason });
      continue;
    }

    const answer = result.text.trim();
    cases.push({
      question: testCase.question,
      expectedTool: testCase.expectedTool,
      agentAnswer: answer,
      matched: answer.toLowerCase().includes(testCase.expectedTool.toLowerCase())
    });
  }

  const matched = cases.filter(result => result.matched).length;
  return {
    generatedAt: new Date().toISOString(),
    summary: { total: cases.length, matched, unmatched: cases.length - matched },
    cases
  };
}

export function renderAgentEvalMarkdown(run: AgentEvalRunResult): string {
  return `# ctxhub Agent Tool-Choice Report

Generated: ${run.generatedAt}
Result: ${run.summary.matched}/${run.summary.total} matched expected tool

## Cases

${run.cases.map(renderAgentCaseMarkdown).join('\n\n')}
`;
}

function renderAgentCaseMarkdown(testCase: AgentEvalCaseResult): string {
  if (testCase.error) {
    return `### SKIPPED: ${testCase.question}\n\nExpected: ${testCase.expectedTool}\nReason: ${testCase.error}`;
  }
  return `### ${testCase.matched ? 'MATCH' : 'MISMATCH'}: ${testCase.question}\n\nExpected: ${testCase.expectedTool}\nAgent said: ${testCase.agentAnswer}`;
}

async function writeAgentEvalReport(run: AgentEvalRunResult, workspaceRoot: string): Promise<string> {
  const stamp = run.generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.resolve(workspaceRoot, EVAL_RUNS_DIR, `agent-${stamp}.md`);
  const latestPath = path.resolve(workspaceRoot, EVAL_RUNS_DIR, 'agent-latest.md');
  const content = renderAgentEvalMarkdown(run);
  await writeText(reportPath, content);
  await writeText(latestPath, content);
  return reportPath;
}

function printEvalSummary(run: EvalRunResult, historyPath: string, reportPath?: string): void {
  const color = run.summary.failed ? chalk.red : chalk.green;
  console.log(chalk.bold('ctxhub eval'));
  console.log(color(`${run.summary.passed}/${run.summary.total} passed · ${run.summary.failed} failed`));
  console.log(chalk.gray(`History: ${path.relative(process.cwd(), historyPath)}`));
  if (reportPath) console.log(chalk.gray(`Report: ${path.relative(process.cwd(), reportPath)}`));
}

export async function evaluateSuite(suite: EvalSuite, search: SearchFn, suitePath = DEFAULT_EVAL_PATH): Promise<EvalRunResult> {
  const cases: EvalCaseResult[] = [];

  for (const testCase of suite.cases) {
    const results = await search(testCase.query, 10);
    const expected = testCase.expected.map(expectation => matchExpected(expectation, results));
    const missing = expected
      .filter(result => !result.rank)
      .map(result => ({ repo: result.repo, path: result.path }));

    cases.push({
      query: testCase.query,
      rationale: testCase.rationale,
      passed: missing.length === 0,
      expected,
      missing,
      topResults: results.slice(0, 5).map(result => ({
        repo: result.repo,
        path: result.filePath,
        title: result.title,
        score: result.score
      }))
    });
  }

  const passed = cases.filter(result => result.passed).length;
  return {
    generatedAt: new Date().toISOString(),
    suitePath,
    summary: {
      total: cases.length,
      passed,
      failed: cases.length - passed
    },
    cases
  };
}

export function renderEvalMarkdown(run: EvalRunResult): string {
  return `# ctxhub Eval Report

Generated: ${run.generatedAt}
Suite: ${run.suitePath}
Result: ${run.summary.passed}/${run.summary.total} passed

## Cases

${run.cases.map(renderCaseMarkdown).join('\n\n')}
`;
}

function renderCaseMarkdown(testCase: EvalCaseResult): string {
  return `### ${testCase.passed ? 'PASS' : 'FAIL'}: ${testCase.query}

${testCase.rationale ? `Rationale: ${testCase.rationale}

` : ''}

Expected:
${testCase.expected.map(expected => `- ${expected.repo ?? '*'}:${expected.path ?? '*'} -> ${expected.rank ? `rank ${expected.rank}, score ${expected.score}` : 'missing'}`).join('\n')}

Top Results:
${testCase.topResults.length ? testCase.topResults.map((result, index) => `- ${index + 1}. ${result.repo}:${result.path} (score ${result.score})${result.title ? ` - ${result.title}` : ''}`).join('\n') : '- none'}`;
}

function matchExpected(expected: EvalExpected, results: SearchResult[]): EvalExpectedResult {
  const index = results.findIndex(result =>
    (!expected.repo || result.repo === expected.repo) &&
    (!expected.path || result.filePath.includes(expected.path))
  );
  if (index < 0) return expected;

  const match = results[index];
  return {
    ...expected,
    rank: index + 1,
    score: match.score,
    matchedRepo: match.repo,
    matchedPath: match.filePath
  };
}

function printEvalRun(run: EvalRunResult): void {
  for (const testCase of run.cases) {
    console.log(`${testCase.passed ? chalk.green('✓') : chalk.red('✗')} ${testCase.query}`);
    for (const expected of testCase.expected) {
      const label = `${expected.repo ?? '*'}:${expected.path ?? '*'}`;
      console.log(expected.rank
        ? `  ${chalk.green('✓')} ${label} rank=${expected.rank} score=${expected.score}`
        : `  ${chalk.red('✗')} ${label} missing`);
    }
  }

  console.log(`${chalk.bold('Result:')} ${run.summary.passed}/${run.summary.total} passed`);
}

async function writeEvalHistory(run: EvalRunResult, workspaceRoot = process.cwd()): Promise<string> {
  const stamp = run.generatedAt.replace(/[:.]/g, '-');
  const historyPath = path.resolve(workspaceRoot, EVAL_RUNS_DIR, `${stamp}.json`);
  const latestPath = path.resolve(workspaceRoot, EVAL_RUNS_DIR, 'latest.json');
  const content = `${JSON.stringify(run, null, 2)}\n`;
  await writeText(historyPath, content);
  await writeText(latestPath, content);
  return historyPath;
}

async function writeEvalReport(run: EvalRunResult, workspaceRoot = process.cwd()): Promise<string> {
  const stamp = run.generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.resolve(workspaceRoot, EVAL_RUNS_DIR, `${stamp}.md`);
  const latestPath = path.resolve(workspaceRoot, EVAL_RUNS_DIR, 'latest.md');
  const content = renderEvalMarkdown(run);
  await writeText(reportPath, content);
  await writeText(latestPath, content);
  return reportPath;
}

export async function suggestEvalQueries(
  suite: EvalSuite,
  config: CtxhubConfig,
  workspaceRoot: string,
  runAgentPromptFn: typeof runAgentPrompt = runAgentPrompt
): Promise<{ suggestions: EvalCase[]; llmNotice?: string }> {
  if (!config.llm.enabled) {
    return { suggestions: [], llmNotice: llmDisabledNotice('eval query suggestions') };
  }

  const manifest = await loadManifest(config.workspace.name, workspaceRoot);
  const preamble = buildPromptPreamble(await loadPolicyText(workspaceRoot));
  const prompt = buildEvalSuggestionPrompt(suite, config, manifest, preamble);
  const result = await runAgentPromptFn(config, prompt);
  if (!result.ok) {
    return { suggestions: [], llmNotice: `Eval query suggestions were unavailable (${result.reason}); keeping the curated suite unchanged.` };
  }

  const suggestions = parseSuggestedEvalCases(result.text);
  if (!suggestions.length) {
    return { suggestions: [], llmNotice: 'Eval query suggestions returned no valid cases; keeping the curated suite unchanged.' };
  }

  return { suggestions };
}

export function appendSuggestedEvalCases(suite: EvalSuite, suggestions: EvalCase[]): { suite: EvalSuite; added: EvalCase[] } {
  const seen = new Set(suite.cases.map(testCase => normalizeQueryKey(testCase.query)));
  const added: EvalCase[] = [];

  for (const suggestion of suggestions) {
    const key = normalizeQueryKey(suggestion.query);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push(suggestion);
  }

  return {
    suite: { cases: [...suite.cases, ...added] },
    added
  };
}

function buildEvalSuggestionPrompt(
  suite: EvalSuite,
  config: CtxhubConfig,
  manifest: Awaited<ReturnType<typeof loadManifest>>,
  preamble = ''
): string {
  const existingQueries = suite.cases.slice(0, 50).map(testCase => `- ${testCase.query}`).join('\n') || '- (none)';
  const repoList = config.repositories.map(repo => `- ${repo.name}: ${repo.path}`).join('\n') || '- (none)';
  const fileHints = Object.values(manifest.files)
    .slice(0, 80)
    .map(file => `- ${file.repo}:${file.filePath}`)
    .join('\n') || '- (none)';

  return preamble + [
    'You are suggesting additional golden queries for a ctxhub eval suite.',
    '',
    'Existing queries (do not repeat these):',
    existingQueries,
    '',
    'Configured repos:',
    repoList,
    '',
    'Indexed file hints (use only these repo:path pairs in expected matches; never invent unseen files):',
    fileHints,
    '',
    'Return strict JSON only with this shape:',
    '{"cases":[{"query":"question","expected":[{"repo":"name","path":"file/path"}],"rationale":"why this query belongs in the suite"}]}',
    'Guidelines:',
    '- Suggest 3 to 5 realistic developer questions.',
    '- Each case must include at least one expected repo/path drawn from the hints above.',
    '- Keep the rationale short and specific.',
    '- Prefer coverage across different repos or concerns, not many variants of the same question.'
  ].join('\n');
}

function parseSuggestedEvalCases(raw: string): EvalCase[] {
  try {
    const normalized = raw.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(normalized) as { cases?: Array<{ query?: unknown; expected?: Array<{ repo?: unknown; path?: unknown }>; rationale?: unknown }> };
    if (!Array.isArray(parsed.cases)) return [];

    return parsed.cases
      .map(testCase => ({
        query: typeof testCase.query === 'string' ? testCase.query.trim() : '',
        expected: Array.isArray(testCase.expected)
          ? testCase.expected
            .map(expected => ({
              repo: typeof expected.repo === 'string' ? expected.repo.trim() : undefined,
              path: typeof expected.path === 'string' ? expected.path.trim() : undefined
            }))
            .filter(expected => Boolean(expected.repo || expected.path))
          : [],
        rationale: typeof testCase.rationale === 'string' ? testCase.rationale.trim() : undefined
      }))
      .filter(testCase => testCase.query && testCase.expected.length);
  } catch {
    return [];
  }
}

function normalizeQueryKey(query: string): string {
  return query.trim().toLowerCase();
}
