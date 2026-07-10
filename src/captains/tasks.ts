import path from 'node:path';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';

// docs/control-plane.md Phase 6: a Captain task is plain, editable config -- which workspace,
// what question to ask it, and (optionally) which persona/execution profile to frame and run it
// under -- not hardcoded dispatch logic. Reuses the exact same evidence-grounded
// createExplainResult machinery every other persona-driven command already uses (see runner.ts);
// a task is really just "run ctxhub explain unattended, on a trigger, against a named workspace."
export type CaptainTask = {
  name: string;
  workspace: string;
  query: string;
  persona?: string;
  profile?: string;
  // Opt-in scheduled trigger: when the ctxhub service (Phase 2) is running in the background, it
  // polls task definitions and runs any that are due. Absent means manual-only (`ctxhub captain
  // run <name>`) -- the default, since nothing should start running unattended without an
  // explicit opt-in.
  schedule?: { everyMinutes: number };
  // Opt-in task-to-task handoff: the name of another captain task (in this same tasks file) to
  // run immediately after this one finishes, with this task's answer folded into the target's
  // query as context. Lets one Captain's findings feed directly into the next Captain's question
  // -- e.g. an "audit" task hands off to a "draft fix notes" task -- without a human relaying the
  // answer by hand in between. See runner.ts for cycle detection.
  handoffTo?: string;
};

export type CaptainTaskFile = {
  version: 1;
  tasks: CaptainTask[];
};

export function getCaptainTasksPath(): string {
  return path.join(getCtxhubHome(), 'captains.json');
}

export async function loadCaptainTasks(tasksPath = getCaptainTasksPath()): Promise<CaptainTaskFile> {
  if (!(await pathExists(tasksPath))) return { version: 1, tasks: [] };

  const raw = await readText(tasksPath);
  const parsed = JSON.parse(raw) as Partial<CaptainTaskFile>;
  return { version: 1, tasks: parsed.tasks ?? [] };
}

export async function saveCaptainTasks(file: CaptainTaskFile, tasksPath = getCaptainTasksPath()): Promise<void> {
  await writeText(tasksPath, `${JSON.stringify(file, null, 2)}\n`);
}

export async function addCaptainTask(task: CaptainTask, tasksPath = getCaptainTasksPath()): Promise<void> {
  const file = await loadCaptainTasks(tasksPath);
  if (file.tasks.some(existing => existing.name === task.name)) {
    throw new Error(`A captain task named "${task.name}" already exists. Remove it first or choose a different name.`);
  }

  if (task.schedule !== undefined && task.schedule.everyMinutes < 1) {
    throw new Error(`schedule.everyMinutes must be at least 1; got ${task.schedule.everyMinutes}.`);
  }

  if (task.handoffTo === task.name) {
    throw new Error(`A captain task cannot hand off to itself.`);
  }

  file.tasks.push(task);
  await saveCaptainTasks(file, tasksPath);
}

export async function removeCaptainTask(name: string, tasksPath = getCaptainTasksPath()): Promise<boolean> {
  const file = await loadCaptainTasks(tasksPath);
  const index = file.tasks.findIndex(task => task.name === name);
  if (index === -1) return false;

  file.tasks.splice(index, 1);
  await saveCaptainTasks(file, tasksPath);
  return true;
}

export async function getCaptainTask(name: string, tasksPath = getCaptainTasksPath()): Promise<CaptainTask | undefined> {
  const file = await loadCaptainTasks(tasksPath);
  return file.tasks.find(task => task.name === name);
}
