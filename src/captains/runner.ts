import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { createExplainResult, type ExplainResult } from '../commands/explain.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { draftedNoteTemplate, NOTES_DIR, slugify, todayIsoDate } from '../commands/note.js';
import { getCtxhubHome, listWorkspaces } from '../workspaces/registry.js';
import type { CaptainTask } from './tasks.js';
import { ensureDir, pathExists, readText, writeText } from '../utils/fs.js';

// docs/control-plane.md Phase 6: a Captain never writes to a repo on its own. `runCaptainTask`
// only ever writes to this user-level, non-git-tracked pending-runs queue -- the "Approvals
// queue" the brief calls for. Turning a pending run into a real, team-visible artifact is a
// separate, explicit human action (`promoteCaptainRun`), matching the same human-in-the-loop
// discipline every other invasive/write-capable ctxhub feature already requires
// (`--fix-skills`, `--fix-personas`, `--allow-index`, `--allow-memory-write`).
export type CaptainRunRecord = {
  runId: string;
  task: string;
  workspace: string;
  startedAt: string;
  result: ExplainResult;
};

export function getCaptainRunsDir(taskName: string): string {
  return path.join(getCtxhubHome(), 'captains', taskName);
}

export async function runCaptainTask(task: CaptainTask): Promise<CaptainRunRecord> {
  const workspaces = await listWorkspaces();
  const workspaceEntry = workspaces.find(entry => entry.name === task.workspace);
  if (!workspaceEntry) {
    throw new Error(`Captain task "${task.name}" targets unregistered workspace "${task.workspace}". Run: ctxhub workspace list`);
  }
  if (!workspaceEntry.exists) {
    throw new Error(`Workspace "${task.workspace}" is registered but its path no longer exists: ${workspaceEntry.path}`);
  }

  const result = await createExplainResult(task.query, 8, workspaceEntry.path, {
    persona: task.persona,
    profile: task.profile
  });

  const startedAt = new Date().toISOString();
  const runId = startedAt.replace(/[:.]/g, '-');
  const record: CaptainRunRecord = { runId, task: task.name, workspace: task.workspace, startedAt, result };

  const runsDir = getCaptainRunsDir(task.name);
  await ensureDir(runsDir);
  await writeText(path.join(runsDir, `${runId}.json`), `${JSON.stringify(record, null, 2)}\n`);

  return record;
}

export async function listCaptainRuns(taskName: string): Promise<CaptainRunRecord[]> {
  const runsDir = getCaptainRunsDir(taskName);
  if (!(await pathExists(runsDir))) return [];

  const files = (await readdir(runsDir)).filter(file => file.endsWith('.json')).sort();
  const records: CaptainRunRecord[] = [];
  for (const file of files) {
    records.push(JSON.parse(await readText(path.join(runsDir, file))) as CaptainRunRecord);
  }
  return records;
}

export async function getCaptainRun(taskName: string, runId: string): Promise<CaptainRunRecord | undefined> {
  const runPath = path.join(getCaptainRunsDir(taskName), `${runId}.json`);
  if (!(await pathExists(runPath))) return undefined;
  return JSON.parse(await readText(runPath)) as CaptainRunRecord;
}

// The one deliberate, human-invoked action that turns a pending Captain run into a real
// git-tracked artifact -- reuses note.ts's existing `draftedNoteTemplate` unmodified (the exact
// same "AI draft, review before merge" shape `note add --draft` already produces), rather than
// inventing a second promoted-content format.
export async function promoteCaptainRun(
  taskName: string,
  runId: string,
  repoName: string,
  opts: { title?: string; agent?: string } = {}
): Promise<string> {
  const record = await getCaptainRun(taskName, runId);
  if (!record) {
    throw new Error(`No run "${runId}" found for captain task "${taskName}". Run: ctxhub captain runs ${taskName}`);
  }

  // Resolves the repo within the run's own target workspace, not wherever `ctxhub captain
  // promote` happens to be invoked from -- a Captain run can be promoted from anywhere.
  const workspaces = await listWorkspaces();
  const workspaceEntry = workspaces.find(entry => entry.name === record.workspace);
  if (!workspaceEntry || !workspaceEntry.exists) {
    throw new Error(`Workspace "${record.workspace}" is no longer registered or its path no longer exists.`);
  }

  const { config, workspaceRoot } = await loadWorkspaceConfig(workspaceEntry.path);
  const repo = config.repositories.find(candidate => candidate.name === repoName);
  if (!repo) {
    throw new Error(`Repository not found: ${repoName}. Run: ctxhub repo list`);
  }

  const title = opts.title ?? record.result.query;
  const date = todayIsoDate();
  const notePath = path.join(workspaceRoot, repo.path, NOTES_DIR, `${date}-${slugify(title)}.md`);
  if (await pathExists(notePath)) {
    throw new Error(`${notePath} already exists.`);
  }

  const body = buildCaptainNoteBody(record.result);
  await writeText(notePath, draftedNoteTemplate(title, opts.agent ?? `captain:${taskName}`, date, body));
  return notePath;
}

function buildCaptainNoteBody(result: ExplainResult): string {
  const lines = ['## Answer', ...result.answer.map(line => `- ${line}`)];
  if (result.citations.length) {
    lines.push('', '## Citations', ...result.citations.map(c => `- [${c.ref}] ${c.repo}:${c.path}${c.title ? ` (${c.title})` : ''}`));
  }
  return lines.join('\n');
}
