import path from 'node:path';
import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import { pathExists, writeText } from '../utils/fs.js';

export const NOTES_DIR = 'agent-notes';

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'note';
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function noteTemplate(title: string, agent: string, date: string): string {
  return `---
agent: ${agent}
date: ${date}
---

# ${title}

<!--
Replace this with the note content. This file is git-tracked and will show up in a PR diff --
write it for a teammate to read, not just yourself. Once merged, ctxhub's index picks it up
like any other doc (it already matches the default **/*.md include glob).

Not for this: anything personal/session-specific that doesn't need review -- use MemPalace
(mempalace_add_drawer, mempalace_checkpoint) for that instead.
-->
`;
}

export async function noteAddCommand(repoName: string, title: string, opts: { agent?: string } = {}) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const repo = config.repositories.find(r => r.name === repoName);
  if (!repo) {
    throw new Error(`Repository not found: ${repoName}. Run: ctxhub repo list`);
  }

  const slug = slugify(title);
  const date = todayIsoDate();
  const fileName = `${date}-${slug}.md`;
  const notePath = path.join(workspaceRoot, repo.path, NOTES_DIR, fileName);

  if (await pathExists(notePath)) {
    throw new Error(`${notePath} already exists.`);
  }

  await writeText(notePath, noteTemplate(title, opts.agent ?? 'unknown', date));

  console.log(chalk.green(`Created ${path.join(repo.path, NOTES_DIR, fileName)}`));
  console.log(chalk.gray('Fill in the content, then commit it through a normal PR — ctxhub will index it on the next sync.'));
}
