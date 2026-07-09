import path from 'node:path';
import chalk from 'chalk';
import { CACHE_DIR, loadConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { pathExists, readText, writeText } from '../utils/fs.js';

type EvalCase = { query: string; expected: Array<{ repo?: string; path?: string }> };
type EvalSuite = { cases: EvalCase[] };

const DEFAULT_EVAL_PATH = path.join(CACHE_DIR, 'eval.json');

export async function evalCommand(opts: { file?: string; init?: boolean } = {}) {
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
  let passed = 0;

  for (const testCase of suite.cases) {
    const results = await index.search(testCase.query, 10);
    const ok = testCase.expected.every(expected =>
      results.some(result =>
        (!expected.repo || result.repo === expected.repo) &&
        (!expected.path || result.filePath.includes(expected.path))
      )
    );
    if (ok) passed++;
    console.log(`${ok ? chalk.green('✓') : chalk.red('✗')} ${testCase.query}`);
  }

  console.log(`${chalk.bold('Result:')} ${passed}/${suite.cases.length} passed`);
  if (passed !== suite.cases.length) process.exitCode = 1;
}
