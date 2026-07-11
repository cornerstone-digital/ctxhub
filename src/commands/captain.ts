import chalk from 'chalk';
import { rm } from 'node:fs/promises';
import { addCaptainTask, getCaptainTask, loadCaptainTasks, removeCaptainTask, type CaptainTask } from '../captains/tasks.js';
import { getCaptainRunsDir, listCaptainRuns, promoteCaptainRun, runCaptainTask, type CaptainRunRecord } from '../captains/runner.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import { DEFAULT_SERVICE_PORT } from '../service/server.js';
import { isServiceRunning } from './service.js';

export async function captainAddCommand(
  name: string,
  opts: { workspace?: string; query?: string; persona?: string; profile?: string; scheduleEveryMinutes?: string; handoffTo?: string } = {}
) {
  if (!opts.workspace) throw new Error('--workspace is required.');
  if (!opts.query) throw new Error('--query is required.');

  const everyMinutes = opts.scheduleEveryMinutes ? Number(opts.scheduleEveryMinutes) : undefined;
  if (everyMinutes !== undefined && (!Number.isFinite(everyMinutes) || everyMinutes <= 0)) {
    throw new Error('--schedule-every-minutes must be a positive number.');
  }

  await addCaptainTask({
    name,
    workspace: opts.workspace,
    query: opts.query,
    persona: opts.persona,
    profile: opts.profile,
    schedule: everyMinutes ? { everyMinutes } : undefined,
    handoffTo: opts.handoffTo
  });
  console.log(chalk.green(`Added captain task "${name}" targeting workspace "${opts.workspace}".`));
  if (everyMinutes) {
    console.log(chalk.gray(`Scheduled: runs every ${everyMinutes} minute(s) while \`ctxhub service\` is running.`));
  }
  if (opts.handoffTo) {
    console.log(chalk.gray(`Hands off to "${opts.handoffTo}" on completion, with this task's answer folded in as context.`));
  }
}

export async function captainListCommand() {
  const file = await loadCaptainTasks();
  if (!file.tasks.length) {
    console.log(chalk.yellow('No captain tasks configured. Run: ctxhub captain add <name> --workspace <name> --query "..."'));
    return;
  }

  for (const task of file.tasks) {
    const extras = [
      task.persona ? `persona=${task.persona}` : undefined,
      task.profile ? `profile=${task.profile}` : undefined,
      task.schedule ? `every=${task.schedule.everyMinutes}m` : undefined,
      task.handoffTo ? `handoff-to=${task.handoffTo}` : undefined
    ]
      .filter(Boolean)
      .join(' ');
    console.log(`${chalk.green('✓')} ${task.name} ${chalk.gray(`(${task.workspace})`)} "${task.query}"${extras ? ` ${chalk.gray(extras)}` : ''}`);
  }
}

export async function captainRemoveCommand(name: string, opts: { purgeRuns?: boolean } = {}) {
  const removed = await removeCaptainTask(name);
  if (!removed) {
    console.log(chalk.yellow(`No captain task named "${name}".`));
    return;
  }

  const runsDir = getCaptainRunsDir(name);
  const hasRuns = await pathExists(runsDir);

  if (opts.purgeRuns) {
    if (hasRuns) {
      await rm(runsDir, { recursive: true, force: true });
      console.log(chalk.green(`Removed captain task "${name}" and its run history.`));
    } else {
      console.log(chalk.green(`Removed captain task "${name}" (no run history found).`));
    }
  } else {
    console.log(chalk.green(`Removed captain task "${name}".`));
    if (hasRuns) {
      console.log(chalk.gray(`  Run history preserved at ${runsDir}`));
      console.log(chalk.gray(`  Use --purge-runs to delete it, or rm -rf it manually.`));
    }
  }
}

// If `ctxhub service` is running, routes the run through it instead of executing in this
// disposable CLI process -- so it publishes to the same eventBus the service's SSE
// subscribers/dashboard are already listening to, and shows up as real agent activity there
// instead of only appearing after the fact via `ctxhub captain approvals`. Falls back to running
// locally (previous behavior, no dashboard visibility) if the service isn't reachable.
async function runCaptainTaskPreferService(task: CaptainTask): Promise<CaptainRunRecord> {
  // isServiceRunning() checks this CTXHUB_HOME's own PID file, not just "is anything listening
  // on the port" -- matters for test isolation (an unrelated real service on the same machine
  // shouldn't be mistaken for this workspace's), and is the right check either way since a port
  // probe alone can't tell whether that's actually *this* home's service.
  if (!(await isServiceRunning())) return runCaptainTask(task);

  const res = await fetch(`http://127.0.0.1:${DEFAULT_SERVICE_PORT}/captains/${encodeURIComponent(task.name)}/run`, { method: 'POST' })
    .catch(() => null);
  if (!res) return runCaptainTask(task);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Captain run failed via ctxhub service (HTTP ${res.status})`);
  }
  return (await res.json()) as CaptainRunRecord;
}

export async function captainRunCommand(name: string) {
  const task = await getCaptainTask(name);
  if (!task) {
    throw new Error(`No captain task named "${name}". Run: ctxhub captain list`);
  }

  const record = await runCaptainTaskPreferService(task);
  console.log(chalk.green(`Ran captain task "${name}" (run ${record.runId}) against workspace "${record.workspace}".`));
  for (const line of record.result.answer) console.log(`- ${line}`);
  if (record.result.llmNotice) console.log(chalk.dim(record.result.llmNotice));
  console.log(chalk.gray(`Pending review. Promote with: ctxhub captain promote ${name} ${record.runId} <repo>`));
  if (task.handoffTo) {
    console.log(chalk.gray(`Handed off to "${task.handoffTo}". Check its result with: ctxhub captain approvals ${task.handoffTo}`));
  }
}

export async function captainApprovalsCommand(name: string) {
  const { records: runs } = await listCaptainRuns(name);
  if (!runs.length) {
    console.log(chalk.yellow(`No pending runs for captain task "${name}". Run: ctxhub captain run ${name}`));
    return;
  }

  for (const run of runs) {
    console.log(`${chalk.green('✓')} ${run.runId} ${chalk.gray(run.startedAt)}`);
    for (const line of run.result.answer) console.log(`  - ${line}`);
  }
}

export async function captainPromoteCommand(
  name: string,
  runId: string,
  repo: string,
  opts: { title?: string; agent?: string } = {}
) {
  const notePath = await promoteCaptainRun(name, runId, repo, opts);
  console.log(chalk.green(`Promoted run ${runId} of "${name}" into ${notePath}`));
  console.log(chalk.gray('Review and edit before merging -- this is an AI draft, same as `note add --draft`.'));
}

// Exports captain task definitions (not run history) to a portable JSON file.
// Run history is per-machine and too large for casual export; definitions are small and
// are the thing you actually want to share or commit.
export async function captainExportCommand(outputPath: string) {
  const { tasks } = await loadCaptainTasks();
  if (!tasks.length) {
    console.log(chalk.yellow('No captain tasks to export.'));
    return;
  }
  const payload = JSON.stringify({ version: 1, tasks }, null, 2);
  await writeText(outputPath, `${payload}\n`);
  console.log(chalk.green(`Exported ${tasks.length} captain task${tasks.length !== 1 ? 's' : ''} to ${outputPath}`));
}

// Imports captain task definitions from a file produced by `ctxhub captain export`.
// Existing tasks with the same name are skipped (not overwritten) unless --overwrite is passed.
export async function captainImportCommand(inputPath: string, opts: { overwrite?: boolean } = {}) {
  if (!(await pathExists(inputPath))) throw new Error(`File not found: ${inputPath}`);

  let parsed: { version?: number; tasks?: CaptainTask[] };
  try {
    parsed = JSON.parse(await readText(inputPath)) as typeof parsed;
  } catch {
    throw new Error(`Could not parse ${inputPath} — expected a JSON file produced by \`ctxhub captain export\`.`);
  }

  if (!Array.isArray(parsed.tasks)) {
    throw new Error(`Invalid export file: expected a "tasks" array.`);
  }

  const { tasks: existing } = await loadCaptainTasks();
  const existingNames = new Set(existing.map(t => t.name));

  let added = 0;
  let skipped = 0;
  for (const task of parsed.tasks) {
    if (existingNames.has(task.name) && !opts.overwrite) {
      console.log(chalk.gray(`  Skipped "${task.name}" (already exists — use --overwrite to replace)`));
      skipped++;
    } else {
      await addCaptainTask(task);
      console.log(chalk.green(`  Imported "${task.name}"`));
      added++;
    }
  }

  console.log(chalk.green(`Done: ${added} imported, ${skipped} skipped.`));
}
