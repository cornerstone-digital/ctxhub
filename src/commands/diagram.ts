import path from 'node:path';
import chalk from 'chalk';
import { loadConfig } from '../config/config.js';
import { pathExists, writeText } from '../utils/fs.js';

const DEFAULT_DIAGRAM_DIR = path.join('docs', 'architecture');

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'architecture-diagram';
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function diagramTemplate(title: string, agent: string, diagramType: string, date: string): string {
  const graphType = diagramType || 'flowchart';
  return `%% title: ${title}
%% agent: ${agent}
%% date: ${date}
%% This file is git-tracked team architecture context. Keep node names stable and review changes in PRs.

${graphType} TD
  System[System] --> Component[Component]
`;
}

export async function diagramAddCommand(
  repoName: string,
  title: string,
  opts: { agent?: string; dir?: string; type?: string } = {}
) {
  const config = await loadConfig();
  const repo = config.repositories.find(r => r.name === repoName);
  if (!repo) {
    throw new Error(`Repository not found: ${repoName}. Run: ctxhub repo list`);
  }

  const date = todayIsoDate();
  const fileName = `${date}-${slugify(title)}.mmd`;
  const diagramDir = opts.dir ?? DEFAULT_DIAGRAM_DIR;
  const diagramPath = path.join(process.cwd(), repo.path, diagramDir, fileName);

  if (await pathExists(diagramPath)) {
    throw new Error(`${diagramPath} already exists.`);
  }

  await writeText(diagramPath, diagramTemplate(title, opts.agent ?? 'unknown', opts.type ?? 'flowchart', date));

  console.log(chalk.green(`Created ${path.join(repo.path, diagramDir, fileName)}`));
  console.log(chalk.gray('Edit the Mermaid diagram, commit it through a normal PR, then run ctxhub index or ctxhub sync.'));
}
