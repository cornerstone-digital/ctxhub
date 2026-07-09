import path from 'node:path';
import chalk from 'chalk';
import { CACHE_DIR, loadConfig } from '../config/config.js';
import type { SearchResult } from '../config/types.js';
import { createIndexProvider } from '../indexing/providers.js';
import { pathExists, readText, writeText } from '../utils/fs.js';

export type EvalExpected = { repo?: string; path?: string };
export type EvalCase = { query: string; expected: EvalExpected[] };
export type EvalSuite = { cases: EvalCase[] };
export type EvalExpectedResult = EvalExpected & { rank?: number; score?: number; matchedPath?: string; matchedRepo?: string };
export type EvalCaseResult = {
  query: string;
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

export async function evalCommand(opts: { file?: string; init?: boolean; json?: boolean; report?: boolean } = {}) {
  const filePath = path.resolve(process.cwd(), opts.file ?? DEFAULT_EVAL_PATH);
  if (opts.init || !(await pathExists(filePath))) {
    await writeText(filePath, JSON.stringify({ cases: [{ query: 'authentication flow', expected: [{ path: 'README.md' }] }] }, null, 2));
    console.log(chalk.green(`Created ${path.relative(process.cwd(), filePath)}`));
    if (!opts.init) console.log(chalk.gray('Edit this file with real expected hits, then run ctxhub eval again.'));
    return;
  }

  const suite = JSON.parse(await readText(filePath)) as EvalSuite;
  const config = await loadConfig();
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table);
  const run = await evaluateSuite(suite, (query, limit) => index.search(query, limit), filePath);
  const historyPath = await writeEvalHistory(run);
  const reportPath = opts.report ? await writeEvalReport(run) : undefined;

  if (opts.json) {
    console.log(JSON.stringify({ ...run, historyPath, reportPath }, null, 2));
    if (run.summary.failed) process.exitCode = 1;
    return;
  }

  if (opts.report && reportPath) {
    console.log(chalk.green(`Wrote eval report: ${path.relative(process.cwd(), reportPath)}`));
  }

  printEvalRun(run);
  if (run.summary.failed) process.exitCode = 1;
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

async function writeEvalHistory(run: EvalRunResult): Promise<string> {
  const stamp = run.generatedAt.replace(/[:.]/g, '-');
  const historyPath = path.resolve(process.cwd(), EVAL_RUNS_DIR, `${stamp}.json`);
  const latestPath = path.resolve(process.cwd(), EVAL_RUNS_DIR, 'latest.json');
  const content = `${JSON.stringify(run, null, 2)}\n`;
  await writeText(historyPath, content);
  await writeText(latestPath, content);
  return historyPath;
}

async function writeEvalReport(run: EvalRunResult): Promise<string> {
  const stamp = run.generatedAt.replace(/[:.]/g, '-');
  const reportPath = path.resolve(process.cwd(), EVAL_RUNS_DIR, `${stamp}.md`);
  const latestPath = path.resolve(process.cwd(), EVAL_RUNS_DIR, 'latest.md');
  const content = renderEvalMarkdown(run);
  await writeText(reportPath, content);
  await writeText(latestPath, content);
  return reportPath;
}
