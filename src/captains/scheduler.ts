import { loadCaptainTasks, type CaptainTask } from './tasks.js';
import { listCaptainRuns, runCaptainTask, type CaptainRunRecord } from './runner.js';

// docs/control-plane.md Phase 6 follow-up: the scheduled trigger `ctxhub captain run` alone
// deliberately deferred. A task is "due" purely from its own schedule and its own run history --
// no separate "last run" state file to keep in sync, since listCaptainRuns's pending-queue files
// already record exactly when each run happened.
export function isCaptainTaskDue(task: CaptainTask, runs: CaptainRunRecord[], now = new Date()): boolean {
  if (!task.schedule) return false;
  if (!runs.length) return true;

  const lastRun = runs[runs.length - 1];
  const intervalMs = Math.max(1, task.schedule.everyMinutes) * 60_000;
  const dueAt = new Date(lastRun.startedAt).getTime() + intervalMs;
  return now.getTime() >= dueAt;
}

// Called on an interval by the running ctxhub service (src/commands/service.ts). Still only ever
// writes to the non-git-tracked pending-approval queue via runCaptainTask -- scheduling changes
// *when* a task runs, never what it's allowed to do once it runs.
export async function runDueCaptainTasks(now = new Date()): Promise<CaptainRunRecord[]> {
  const { tasks } = await loadCaptainTasks();

  const dueTasks: CaptainTask[] = [];
  for (const task of tasks) {
    if (!task.schedule) continue;
    const { records: runs } = await listCaptainRuns(task.name, { limit: 1 });
    if (!isCaptainTaskDue(task, runs, now)) continue;
    dueTasks.push(task);
  }

  const results = await Promise.allSettled(
    dueTasks.map(task => runCaptainTask(task))
  );

  const ran: CaptainRunRecord[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      ran.push(result.value);
    } else {
      console.error('[captain] task failed:', result.reason instanceof Error ? result.reason.message : String(result.reason));
    }
  }

  return ran;
}
