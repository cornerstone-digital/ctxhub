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

  const labelWidth = 'Tokens a full-file read would have cost'.length + 2;
  function row(label: string, value: string): string {
    return `  ${chalk.bold(label.padEnd(labelWidth))}${value}`;
  }

  console.log(chalk.bold.underline('ctxhub token savings (estimated)'));
  console.log('');
  console.log(row('Since', summary.since ?? '—'));
  console.log(row('Tool calls', String(summary.totalCalls)));
  console.log(row('Tokens returned', summary.tokensReturned.toLocaleString()));
  console.log(row('Tokens a full-file read would have cost', summary.tokensBaseline.toLocaleString()));
  console.log(row('Estimated tokens saved', `${summary.tokensSaved.toLocaleString()} (${summary.savingsPercent}%)`));

  console.log('');
  console.log(chalk.bold.underline('By tool'));
  console.log('');
  for (const tool of summary.tools) {
    console.log(row(tool.tool, `${tool.calls} calls, ~${tool.tokensSaved.toLocaleString()} tokens saved`));
  }

  console.log('');
  console.log(chalk.dim('Heuristic estimate (chars/4), assuming the alternative was reading each matched file in full — a directional signal, not exact accounting.'));
  if (summary.tokensSaved < 0) {
    console.log(chalk.dim("Negative here usually means only very small files matched — ctxhub's response metadata (guidance, follow-up hints) outweighed the small file(s) it replaced."));
  }
}
