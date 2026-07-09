import path from 'node:path';
import chalk from 'chalk';
import { loadConfig } from '../config/config.js';
import { runGit } from '../git/git.js';
import { createContextPack } from '../context/pack.js';

export async function prContextCommand(opts: { base?: string; json?: boolean; limit?: string } = {}) {
  const config = await loadConfig();
  const changed = new Map<string, string[]>();
  const base = opts.base ?? 'origin/main';

  for (const repo of config.repositories) {
    const repoPath = path.resolve(process.cwd(), repo.path);
    try {
      const files = (await runGit(['diff', '--name-only', `${base}...HEAD`], repoPath)).split('\n').filter(Boolean);
      if (files.length) changed.set(repo.name, files);
    } catch {
      // Repos without the requested base are simply skipped.
    }
  }

  const query = [...changed.entries()].flatMap(([repo, files]) => [repo, ...files]).join(' ') || 'current branch changes';
  const pack = await createContextPack(query, Number(opts.limit ?? 8));
  const payload = { base, changed: Object.fromEntries(changed), contextPack: pack };

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(chalk.bold(`PR context vs ${base}`));
  for (const [repo, files] of changed) {
    console.log(`\n${chalk.green(repo)}`);
    for (const file of files) console.log(`- ${file}`);
  }
  console.log(`\n${chalk.bold('Suggested context')}`);
  for (const item of pack.suggestedReadingOrder) console.log(`${item.repo} ${item.path}${item.title ? ` - ${item.title}` : ''}`);
}
