import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createExplainResult, type ExplainResult } from '../commands/explain.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { draftedNoteTemplate, NOTES_DIR, slugify, todayIsoDate } from '../commands/note.js';
import { getCtxhubHome, listWorkspaces } from '../workspaces/registry.js';
import { loadCaptainTasks, type CaptainTask } from './tasks.js';
import { ensureDir, pathExists, readText, writeText } from '../utils/fs.js';
import { eventBus } from '../events/eventBus.js';

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
  // Set when this run was triggered by another captain's `handoffTo`, not run directly.
  handoffFrom?: string;
};

export function getCaptainRunsDir(taskName: string): string {
  return path.join(getCtxhubHome(), 'captains', taskName);
}

// A run's own answer, trimmed to what's worth handing to the next Captain as context -- the full
// ExplainResult also carries citations/evidence/freshness the receiving task doesn't need and
// that would just bloat its query.
function summarizeForHandoff(result: ExplainResult): string {
  return result.answer.join('\n');
}

export async function runCaptainTask(
  task: CaptainTask,
  opts: { handoffFrom?: string; handoffContext?: string; chain?: Set<string> } = {}
): Promise<CaptainRunRecord> {
  // Guards against a misconfigured handoffTo cycle (A -> B -> A) running forever. Each call in a
  // handoff chain shares the same Set, passed down explicitly rather than tracked globally, so
  // unrelated concurrent runs of the same task never trip each other's cycle guard.
  const chain = opts.chain ?? new Set<string>();
  if (chain.has(task.name)) {
    const error = `Handoff cycle detected: "${task.name}" already ran earlier in this chain (${[...chain].join(' -> ')} -> ${task.name}).`;
    eventBus.publish({ type: 'captain.run.failed', task: task.name, workspace: task.workspace, error });
    throw new Error(error);
  }
  chain.add(task.name);

  const workspaces = await listWorkspaces();
  const workspaceEntry = workspaces.find(entry => entry.name === task.workspace);
  if (!workspaceEntry) {
    throw new Error(`Captain task "${task.name}" targets unregistered workspace "${task.workspace}". Run: ctxhub workspace list`);
  }
  if (!workspaceEntry.exists) {
    throw new Error(`Workspace "${task.workspace}" is registered but its path no longer exists: ${workspaceEntry.path}`);
  }

  eventBus.publish({ type: 'captain.run.started', task: task.name, workspace: task.workspace });

  const query = opts.handoffContext
    ? `${task.query}\n\n--- Context handed off from Captain "${opts.handoffFrom}" ---\n${opts.handoffContext}`
    : task.query;

  // Hard timeout on the full explain flow (index read + LLM). The LLM call itself has a
  // 120s deadline inside runAgent, but filesystem I/O can also hang. Without this outer
  // guard, a single stalled task sets pollInFlight = true and freezes the entire scheduler
  // for however long the hang lasts. 3 minutes is generous for any single explain run.
  const CAPTAIN_TIMEOUT_MS = 3 * 60 * 1000;
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`Captain task "${task.name}" timed out after ${CAPTAIN_TIMEOUT_MS / 1000}s. Check your LLM config or workspace index.`)), CAPTAIN_TIMEOUT_MS);
    timer.unref();
  });

  let result;
  try {
    result = await Promise.race([
      createExplainResult(query, 8, workspaceEntry.path, {
        persona: task.persona,
        profile: task.profile
      }),
      timeoutPromise,
    ]);
  } catch (error) {
    eventBus.publish({
      type: 'captain.run.failed',
      task: task.name,
      workspace: task.workspace,
      error: error instanceof Error ? error.message : String(error)
    });
    throw error;
  }

  const startedAt = new Date().toISOString();
  const runId = `${startedAt.replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`;
  const record: CaptainRunRecord = {
    runId,
    task: task.name,
    workspace: task.workspace,
    startedAt,
    result,
    ...(opts.handoffFrom ? { handoffFrom: opts.handoffFrom } : {})
  };

  const runsDir = getCaptainRunsDir(task.name);
  await ensureDir(runsDir);
  await writeText(path.join(runsDir, `${runId}.json`), `${JSON.stringify(record, null, 2)}\n`);

  eventBus.publish({ type: 'captain.run.completed', task: task.name, workspace: task.workspace, runId });

  if (task.handoffTo) {
    const { tasks } = await loadCaptainTasks();
    const targetTask = tasks.find(candidate => candidate.name === task.handoffTo);
    if (!targetTask) {
      eventBus.publish({
        type: 'captain.run.failed',
        task: task.handoffTo,
        workspace: task.workspace,
        error: `Handoff target "${task.handoffTo}" (from "${task.name}") is not a defined captain task.`
      });
    } else {
      eventBus.publish({ type: 'captain.handoff', from: task.name, to: targetTask.name, fromWorkspace: task.workspace, toWorkspace: targetTask.workspace });
      // Best-effort: a broken downstream link in the chain shouldn't erase that *this* task
      // already succeeded and is safely recorded above. Failure is still visible via the
      // captain.run.failed event published inside the recursive call.
      await runCaptainTask(targetTask, { handoffFrom: task.name, handoffContext: summarizeForHandoff(result), chain }).catch(() => {});
    }
  }

  return record;
}

export async function listCaptainRuns(taskName: string, limit = 50): Promise<CaptainRunRecord[]> {
  const runsDir = getCaptainRunsDir(taskName);
  if (!(await pathExists(runsDir))) return [];

  // Sort descending (most-recent first) so the slice keeps the newest runs, not the oldest.
  const files = (await readdir(runsDir)).filter(file => file.endsWith('.json')).sort().reverse().slice(0, limit);
  const records: CaptainRunRecord[] = [];
  for (const file of files) {
    records.push(JSON.parse(await readText(path.join(runsDir, file))) as CaptainRunRecord);
  }
  // Return chronological order so the UI's reverse() yields most-recent-first display.
  return records.reverse();
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
