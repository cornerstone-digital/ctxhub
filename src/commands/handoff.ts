import path from 'node:path';
import chalk from 'chalk';
import { CACHE_DIR, loadWorkspaceConfig } from '../config/config.js';
import type { SearchResult } from '../config/types.js';
import { createContextPack } from '../context/pack.js';
import { runGit } from '../git/git.js';
import { writeText } from '../utils/fs.js';

export type HandoffOptions = {
  repo?: string;
  out?: string;
  fromPr?: boolean;
  base?: string;
  limit?: string;
};

type ContextPack = Awaited<ReturnType<typeof createContextPack>>;

export async function handoffCommand(topic: string, opts: HandoffOptions = {}) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  if (opts.repo && !config.repositories.some(repo => repo.name === opts.repo)) {
    throw new Error(`Repository not found: ${opts.repo}. Run: ctxhub repo list`);
  }

  const limit = Number(opts.limit ?? 8);
  const pack = await createContextPack(opts.repo ? `${topic} ${opts.repo}` : topic, limit);
  const changed = opts.fromPr ? await collectChangedFiles(opts.base ?? 'origin/main') : {};
  const outputPath = opts.out ? path.resolve(process.cwd(), opts.out) : path.resolve(workspaceRoot, defaultHandoffPath(topic));

  await writeText(outputPath, buildHandoffMarkdown({
    topic,
    repo: opts.repo,
    base: opts.fromPr ? opts.base ?? 'origin/main' : undefined,
    changed,
    pack
  }));

  console.log(chalk.green(`Created ${path.relative(process.cwd(), outputPath) || outputPath}`));
}

export function buildHandoffMarkdown(input: {
  topic: string;
  repo?: string;
  base?: string;
  changed: Record<string, string[]>;
  pack: ContextPack;
}): string {
  const suggested = filterByRepo(input.pack.suggestedReadingOrder, input.repo);
  const architecture = filterByRepo(input.pack.architecture, input.repo).slice(0, 8);
  const search = filterByRepo(input.pack.search, input.repo).slice(0, 8);
  const staleResults = search.filter(result => result.freshness?.stale);

  return `# Handoff: ${input.topic}

Generated: ${new Date().toISOString()}
Workspace: ${input.pack.workspace}
${input.repo ? `Scope: ${input.repo}` : 'Scope: workspace'}

## Status

- Index: ${input.pack.status.index.provider}, ${input.pack.status.index.chunkCount} chunks, last indexed ${input.pack.status.index.lastIndexed ?? 'never'}
- Memory: ${input.pack.status.memory.provider}, ${input.pack.status.memory.chunkCount} chunks
- Stale context results: ${staleResults.length}

${input.base ? changedFilesSection(input.changed, input.base) : ''}
## Suggested Reading Order

${suggested.length ? suggested.map(item => `- ${item.repo}:${item.path}${item.title ? ` - ${item.title}` : ''}`).join('\n') : '- No suggested files found.'}

## Architecture Notes

${architecture.length ? architecture.map(item => architectureLine(item)).join('\n') : '- No architecture diagrams found for this topic.'}

## Top Context

${search.length ? search.map(item => contextLine(item)).join('\n\n') : '- No search results found for this topic.'}

## Next Actions

- Re-run \`ctxhub sync\` or \`ctxhub index\` if any context above is stale.
- Open the suggested files before making code changes.
- Update team-shared notes or architecture diagrams if this handoff reveals missing context.
- Use MemPalace for personal/session memory that should not be committed.
`;
}

export function defaultHandoffPath(topic: string, now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return path.join(CACHE_DIR, 'handoffs', `${stamp}-${slugify(topic)}.md`);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'handoff';
}

async function collectChangedFiles(base: string): Promise<Record<string, string[]>> {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const changed = new Map<string, string[]>();

  for (const repo of config.repositories) {
    const repoPath = path.resolve(workspaceRoot, repo.path);
    try {
      const files = (await runGit(['diff', '--name-only', `${base}...HEAD`], repoPath)).split('\n').filter(Boolean);
      if (files.length) changed.set(repo.name, files);
    } catch {
      // Repos without the requested base are skipped, matching pr-context behavior.
    }
  }

  return Object.fromEntries(changed);
}

function changedFilesSection(changed: Record<string, string[]>, base: string): string {
  const repos = Object.entries(changed);
  return `## Changed Files vs ${base}

${repos.length ? repos.map(([repo, files]) => [`### ${repo}`, ...files.map(file => `- ${file}`)].join('\n')).join('\n\n') : '- No changed files found.'}

`;
}

function architectureLine(item: SearchResult): string {
  const relationships = item.relationships?.length ? ` relationships: ${item.relationships.join('; ')}` : '';
  return `- ${item.repo}:${item.filePath}${item.diagramType ? ` (${item.diagramType})` : ''}${relationships}`;
}

function contextLine(item: SearchResult): string {
  const stale = item.freshness?.stale ? ' stale' : '';
  return `### ${item.repo}:${item.filePath}${stale}

${item.title ? `**${item.title}**\n\n` : ''}${item.snippet}`;
}

function filterByRepo<T extends { repo: string }>(items: T[], repo?: string): T[] {
  return repo ? items.filter(item => item.repo === repo) : items;
}
