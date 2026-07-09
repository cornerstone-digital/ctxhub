import path from 'node:path';
import fg from 'fast-glob';
import chalk from 'chalk';
import { loadConfig } from '../config/config.js';
import { pathExists, readText } from '../utils/fs.js';

type ValidationIssue = { file: string; message: string };
const markdownLinkPattern = /\[[^\]]+\]\(([^)]+)\)/g;

export async function validateDocsCommand(opts: { json?: boolean } = {}) {
  const config = await loadConfig();
  const issues: ValidationIssue[] = [];

  for (const repo of config.repositories) {
    const repoPath = path.resolve(process.cwd(), repo.path);
    if (!(await pathExists(repoPath))) continue;
    const files = await fg(['**/*.md', '**/*.mmd', '**/*.mermaid'], {
      cwd: repoPath,
      ignore: repo.exclude ?? config.knowledge.exclude,
      onlyFiles: true
    });

    for (const file of files) {
      const absolutePath = path.join(repoPath, file);
      const content = await readText(absolutePath);
      if (file.endsWith('.md')) {
        for (const match of content.matchAll(markdownLinkPattern)) {
          const target = match[1];
          if (!target || target.startsWith('http') || target.startsWith('#') || target.startsWith('mailto:')) continue;
          const linkPath = target.split('#')[0];
          if (!linkPath) continue;
          if (!(await pathExists(path.resolve(path.dirname(absolutePath), linkPath)))) {
            issues.push({ file: `${repo.name}:${file}`, message: `broken local link: ${target}` });
          }
        }
      }

      if (/\.(mmd|mermaid)$/.test(file) && !/\b(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram|C4Context|C4Container|C4Component)\b/.test(content)) {
        issues.push({ file: `${repo.name}:${file}`, message: 'Mermaid file has no recognized diagram declaration' });
      }
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ issues }, null, 2));
    return;
  }

  if (!issues.length) {
    console.log(chalk.green('✓ docs validation passed'));
    return;
  }

  for (const issue of issues) console.log(`${chalk.red('✗')} ${issue.file}: ${issue.message}`);
  process.exitCode = 1;
}
