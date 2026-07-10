import chalk from 'chalk';
import path from 'node:path';
import { loadWorkspaceConfig, STATS_PATH } from '../config/config.js';
import { readUsageStats, summarizeUsageStats } from '../utils/usageStats.js';

export async function statsCommand(opts: { json?: boolean } = {}) {
  const { workspaceRoot } = await loadWorkspaceConfig();
  const stats = await readUsageStats(path.join(workspaceRoot, STATS_PATH));
  const summary = summarizeUsageStats(stats);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (summary.totalCalls === 0) {
    console.log(chalk.yellow('No ctxhub tool usage recorded yet. Stats accumulate as search/context_pack/open_chunk/get_file_context/architecture tools are called.'));
    return;
  }

  console.log(chalk.bold('ctxhub token savings (estimated)'));
  console.log(`${chalk.bold('Since:')} ${summary.since}`);
  console.log(`${chalk.bold('Tool calls:')} ${summary.totalCalls}`);
  console.log(`${chalk.bold('Tokens returned:')} ${summary.tokensReturned.toLocaleString()}`);
  console.log(`${chalk.bold('Tokens a full-file read would have cost:')} ${summary.tokensBaseline.toLocaleString()}`);
  console.log(`${chalk.bold('Estimated tokens saved:')} ${summary.tokensSaved.toLocaleString()} (${summary.savingsPercent}%)`);

  console.log(`\n${chalk.bold('By tool')}`);
  for (const tool of summary.tools) {
    console.log(`  ${tool.tool}: ${tool.calls} calls, ~${tool.tokensSaved.toLocaleString()} tokens saved`);
  }

  console.log(chalk.dim('\nHeuristic estimate (chars/4), assuming the alternative was reading each matched file in full -- a directional signal, not exact accounting.'));
  if (summary.tokensSaved < 0) {
    console.log(chalk.dim("Negative here usually means only very small files matched -- ctxhub's response metadata (guidance, follow-up hints) outweighed the small file(s) it replaced."));
  }
}
