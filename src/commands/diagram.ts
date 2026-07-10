import path from 'node:path';
import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import type { CtxhubConfig } from '../config/types.js';
import { createContextPack } from '../context/pack.js';
import { runGit } from '../git/git.js';
import { llmDisabledNotice, runAgentPrompt } from '../llm/runAgent.js';
import { pathExists, writeText } from '../utils/fs.js';
import { buildPromptPreamble, loadPolicyText } from '../personas/persona.js';

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

export function draftedDiagramTemplate(
  title: string,
  agent: string,
  diagramType: string,
  date: string,
  draftBody: string
): string {
  return `%% title: ${title}
%% agent: ${agent}
%% date: ${date}
%% AI draft: review every node, edge, and label before merge.

${normalizeDiagramDraft(draftBody, diagramType || 'flowchart')}
`;
}

export async function diagramAddCommand(
  repoName: string,
  title: string,
  opts: { agent?: string; dir?: string; type?: string; draft?: boolean } = {}
) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const repo = config.repositories.find(r => r.name === repoName);
  if (!repo) {
    throw new Error(`Repository not found: ${repoName}. Run: ctxhub repo list`);
  }

  const date = todayIsoDate();
  const fileName = `${date}-${slugify(title)}.mmd`;
  const diagramDir = opts.dir ?? DEFAULT_DIAGRAM_DIR;
  const diagramPath = path.join(workspaceRoot, repo.path, diagramDir, fileName);

  if (await pathExists(diagramPath)) {
    throw new Error(`${diagramPath} already exists.`);
  }

  const agent = opts.agent ?? 'unknown';
  const diagramType = opts.type ?? 'flowchart';
  let content = diagramTemplate(title, agent, diagramType, date);
  let llmNotice: string | undefined;

  if (opts.draft) {
    const pack = await createContextPack(`${repoName} ${title}`, 6);
    const recentCommits = await recentCommitsForRepo(path.join(workspaceRoot, repo.path));
    const preamble = buildPromptPreamble(await loadPolicyText(workspaceRoot));
    const result = await synthesizeDiagramDraft({
      repoName,
      title,
      agent,
      date,
      diagramType,
      evidence: evidenceLinesFromPack(pack),
      recentCommits
    }, config, runAgentPrompt, preamble);
    if (result.content) content = result.content;
    llmNotice = result.llmNotice;
  }

  await writeText(diagramPath, content);

  console.log(chalk.green(`Created ${path.join(repo.path, diagramDir, fileName)}`));
  console.log(chalk.gray(
    opts.draft
      ? 'Review the AI draft, commit it through a normal PR, then run ctxhub index or ctxhub sync.'
      : 'Edit the Mermaid diagram, commit it through a normal PR, then run ctxhub index or ctxhub sync.'
  ));
  if (llmNotice) console.log(chalk.dim(llmNotice));
}

export async function synthesizeDiagramDraft(
  input: {
    repoName: string;
    title: string;
    agent: string;
    date: string;
    diagramType: string;
    evidence: string[];
    recentCommits: string[];
  },
  config: CtxhubConfig,
  runAgentPromptFn: typeof runAgentPrompt = runAgentPrompt,
  preamble = ''
): Promise<{ content?: string; llmNotice?: string }> {
  if (!config.llm.enabled) {
    return { llmNotice: llmDisabledNotice('diagram drafts') };
  }

  const result = await runAgentPromptFn(config, buildDiagramDraftPrompt(input, preamble));
  if (!result.ok) {
    return { llmNotice: `Diagram draft synthesis was unavailable (${result.reason}); writing the standard template instead.` };
  }

  const draftBody = result.text.trim();
  if (!draftBody) {
    return { llmNotice: 'Diagram draft synthesis returned no content; writing the standard template instead.' };
  }

  return { content: draftedDiagramTemplate(input.title, input.agent, input.diagramType, input.date, draftBody) };
}

function buildDiagramDraftPrompt(input: {
  repoName: string;
  title: string;
  diagramType: string;
  evidence: string[];
  recentCommits: string[];
}, preamble = ''): string {
  const commitsBlock = input.recentCommits.length
    ? input.recentCommits.map(commit => `- ${commit}`).join('\n')
    : '- (no recent commits available)';
  const evidenceBlock = input.evidence.length
    ? input.evidence.map(line => `- ${line}`).join('\n')
    : '- (no indexed evidence found)';

  return preamble + [
    `You are drafting a Mermaid ${input.diagramType} diagram for repo ${input.repoName}.`,
    `Title: ${input.title}`,
    '',
    'Recent commits:',
    commitsBlock,
    '',
    'Indexed evidence (ground components and edges only in these repo:path pairs; never invent unseen systems):',
    evidenceBlock,
    '',
    'Output Mermaid source only. Do not wrap it in fences. Start with the diagram declaration.',
    'If evidence is sparse, keep the diagram small and explicitly label uncertain nodes conservatively.'
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

function normalizeDiagramDraft(draftBody: string, diagramType: string): string {
  const unfenced = draftBody
    .trim()
    .replace(/^```(?:mermaid)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  if (/^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment)\b/m.test(unfenced)) {
    return unfenced;
  }

  const defaultDeclaration = diagramType === 'flowchart' ? 'flowchart TD' : diagramType;
  return `${defaultDeclaration}\n${unfenced}`.trim();
}
