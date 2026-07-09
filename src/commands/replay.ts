import chalk from 'chalk';
import { parseContextPackArtifact, replayFreshnessForArtifact } from '../context/export.js';
import { readText } from '../utils/fs.js';

export async function replayCommand(file: string, opts: { json?: boolean } = {}) {
  const artifact = parseContextPackArtifact(await readText(file));
  const freshness = await replayFreshnessForArtifact(artifact);
  const payload = { artifact, replayFreshness: freshness };

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const pack = artifact.pack as {
    suggestedReadingOrder?: Array<{ repo: string; path: string; title?: string }>;
    search?: Array<{ repo: string; filePath: string; title?: string; snippet?: string }>;
  };

  console.log(chalk.bold(`Context pack replay: ${artifact.query}`));
  console.log(chalk.gray(`Workspace: ${artifact.workspace} exported ${artifact.exportedAt} with ctxhub ${artifact.ctxhubVersion}`));

  console.log(`\n${chalk.bold('Repo Freshness')}`);
  for (const repo of freshness) {
    const status = repo.stale ? chalk.yellow('stale') : chalk.green('ok');
    const details = repo.currentCommit
      ? `${repo.exportedCommit?.slice(0, 7) ?? 'unknown'} -> ${repo.currentCommit.slice(0, 7)}`
      : repo.reason ?? 'not checked';
    console.log(`${status} ${repo.repo} ${chalk.gray(details)}`);
  }

  console.log(`\n${chalk.bold('Suggested Reading Order')}`);
  for (const item of pack.suggestedReadingOrder ?? []) {
    console.log(`${chalk.green(item.repo)} ${chalk.gray(item.path)}${item.title ? ` - ${item.title}` : ''}`);
  }

  console.log(`\n${chalk.bold('Search Results')}`);
  for (const result of pack.search ?? []) {
    console.log(`${chalk.green(result.repo)} ${chalk.gray(result.filePath)}`);
    if (result.title) console.log(chalk.bold(result.title));
    if (result.snippet) console.log(result.snippet);
  }
}
