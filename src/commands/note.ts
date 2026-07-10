import path from 'node:path';
import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import type { CtxhubConfig } from '../config/types.js';
import { createContextPack } from '../context/pack.js';
import { runGit } from '../git/git.js';
import { llmDisabledNotice, runAgentPrompt } from '../llm/runAgent.js';
import { searchMempalace } from '../memory/mempalaceCli.js';
import { pathExists, writeText } from '../utils/fs.js';

export const NOTES_DIR = 'agent-notes';

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'note';
}

export function todayIsoDate(): string {
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

export function draftedNoteTemplate(title: string, agent: string, date: string, draftBody: string): string {
  return `---
agent: ${agent}
date: ${date}
draft: ai-pending-review
---

# ${title}

<!-- AI draft: review every claim and edit before merge. -->

${draftBody.trim()}
`;
}

// NEXT_FEATURES #26: promoting a MemPalace hit into a git-tracked note. `promoted-from` records
// exactly where the content came from so a reviewer can trace it back, and the body is copied
// verbatim rather than re-synthesized -- promotion should not silently change what memory said.
export function promotedNoteTemplate(title: string, agent: string, date: string, wing: string, room: string, body: string): string {
  return `---
agent: ${agent}
date: ${date}
promoted-from: mempalace:${wing}/${room}
---

# ${title}

<!--
Promoted from durable MemPalace memory (${wing} / ${room}). Durable memory is personal/
session-scoped by default -- review and edit for a team-facing audience before merging.
-->

${body.trim()}
`;
}

export async function noteAddCommand(repoName: string, title: string, opts: { agent?: string; draft?: boolean } = {}) {
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

  const agent = opts.agent ?? 'unknown';
  let content = noteTemplate(title, agent, date);
  let llmNotice: string | undefined;

  if (opts.draft) {
    const pack = await createContextPack(`${repoName} ${title}`, 6);
    const recentCommits = await recentCommitsForRepo(path.join(workspaceRoot, repo.path));
    const result = await synthesizeNoteDraft({
      repoName,
      title,
      agent,
      date,
      evidence: evidenceLinesFromPack(pack),
      recentCommits
    }, config);
    if (result.content) content = result.content;
    llmNotice = result.llmNotice;
  }

  await writeText(notePath, content);

  console.log(chalk.green(`Created ${path.join(repo.path, NOTES_DIR, fileName)}`));
  console.log(chalk.gray(
    opts.draft
      ? 'Review the AI draft, then commit it through a normal PR — ctxhub will index it on the next sync.'
      : 'Fill in the content, then commit it through a normal PR — ctxhub will index it on the next sync.'
  ));
  if (llmNotice) console.log(chalk.dim(llmNotice));
}

export async function synthesizeNoteDraft(
  input: { repoName: string; title: string; agent: string; date: string; evidence: string[]; recentCommits: string[] },
  config: CtxhubConfig,
  runAgentPromptFn: typeof runAgentPrompt = runAgentPrompt
): Promise<{ content?: string; llmNotice?: string }> {
  if (!config.llm.enabled) {
    return { llmNotice: llmDisabledNotice('note drafts') };
  }

  const result = await runAgentPromptFn(config, buildNoteDraftPrompt(input));
  if (!result.ok) {
    return { llmNotice: `Note draft synthesis was unavailable (${result.reason}); writing the standard template instead.` };
  }

  const draftBody = result.text.trim();
  if (!draftBody) {
    return { llmNotice: 'Note draft synthesis returned no content; writing the standard template instead.' };
  }

  return { content: draftedNoteTemplate(input.title, input.agent, input.date, draftBody) };
}

export async function notePromoteCommand(
  repoName: string,
  query: string,
  opts: { wing?: string; room?: string; hit?: string; title?: string; agent?: string } = {},
  deps: { searchMempalaceFn?: typeof searchMempalace } = {}
) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const repo = config.repositories.find(r => r.name === repoName);
  if (!repo) {
    throw new Error(`Repository not found: ${repoName}. Run: ctxhub repo list`);
  }

  const hitIndex = Number(opts.hit ?? 0);
  const result = await (deps.searchMempalaceFn ?? searchMempalace)(config, workspaceRoot, {
    query,
    wing: opts.wing,
    room: opts.room,
    limit: hitIndex + 1
  });
  if (result.error) {
    throw new Error(result.error);
  }

  const hit = result.results[hitIndex];
  if (!hit) {
    throw new Error(`No MemPalace memory hit found at index ${hitIndex} for query "${query}".`);
  }

  const title = opts.title ?? (hit.text.replace(/\s+/g, ' ').trim().slice(0, 60) || `Promoted memory from ${hit.wing}`);
  const date = todayIsoDate();
  const agent = opts.agent ?? 'unknown';
  const slug = slugify(title);
  const fileName = `${date}-${slug}.md`;
  const notePath = path.join(workspaceRoot, repo.path, NOTES_DIR, fileName);

  if (await pathExists(notePath)) {
    throw new Error(`${notePath} already exists.`);
  }

  await writeText(notePath, promotedNoteTemplate(title, agent, date, hit.wing, hit.room, hit.text));

  console.log(chalk.green(`Promoted MemPalace memory (${hit.wing} / ${hit.room}) into ${path.join(repo.path, NOTES_DIR, fileName)}`));
  console.log(chalk.gray('Review and edit before committing -- durable memory is personal/session-scoped by default, this note is now team-facing.'));
}

function buildNoteDraftPrompt(input: { repoName: string; title: string; evidence: string[]; recentCommits: string[] }): string {
  const commitsBlock = input.recentCommits.length
    ? input.recentCommits.map(commit => `- ${commit}`).join('\n')
    : '- (no recent commits available)';
  const evidenceBlock = input.evidence.length
    ? input.evidence.map(line => `- ${line}`).join('\n')
    : '- (no indexed evidence found)';

  return [
    `You are drafting a git-tracked team note for repo ${input.repoName}.`,
    `Title: ${input.title}`,
    '',
    'Recent commits:',
    commitsBlock,
    '',
    'Indexed evidence (cite only these repo:path pairs when making specific claims; never invent one):',
    evidenceBlock,
    '',
    'Write the markdown body only for the note below the H1 heading. Do not include YAML frontmatter or repeat the title.',
    'Keep it concise and teammate-facing. If the evidence is sparse, say that plainly instead of guessing.'
  ].join('\n');
}

function evidenceLinesFromPack(pack: Awaited<ReturnType<typeof createContextPack>>): string[] {
  return [...pack.architecture, ...pack.search]
    .slice(0, 8)
    .map(item => `${item.repo}:${item.filePath}${item.title ? ` (${item.title})` : ''}`);
}

async function recentCommitsForRepo(repoPath: string): Promise<string[]> {
  try {
    return (await runGit(['log', '--oneline', '-n', '5'], repoPath)).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}
