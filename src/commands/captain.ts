import chalk from 'chalk';
import { addCaptainTask, getCaptainTask, loadCaptainTasks, removeCaptainTask } from '../captains/tasks.js';
import { listCaptainRuns, promoteCaptainRun, runCaptainTask } from '../captains/runner.js';

export async function captainAddCommand(
  name: string,
  opts: { workspace?: string; query?: string; persona?: string; profile?: string } = {}
) {
  if (!opts.workspace) throw new Error('--workspace is required.');
  if (!opts.query) throw new Error('--query is required.');

  await addCaptainTask({ name, workspace: opts.workspace, query: opts.query, persona: opts.persona, profile: opts.profile });
  console.log(chalk.green(`Added captain task "${name}" targeting workspace "${opts.workspace}".`));
}

export async function captainListCommand() {
  const file = await loadCaptainTasks();
  if (!file.tasks.length) {
    console.log(chalk.yellow('No captain tasks configured. Run: ctxhub captain add <name> --workspace <name> --query "..."'));
    return;
  }

  for (const task of file.tasks) {
    const extras = [task.persona ? `persona=${task.persona}` : undefined, task.profile ? `profile=${task.profile}` : undefined]
      .filter(Boolean)
      .join(' ');
    console.log(`${chalk.green('✓')} ${task.name} ${chalk.gray(`(${task.workspace})`)} "${task.query}"${extras ? ` ${chalk.gray(extras)}` : ''}`);
  }
}

export async function captainRemoveCommand(name: string) {
  const removed = await removeCaptainTask(name);
  if (!removed) {
    console.log(chalk.yellow(`No captain task named "${name}".`));
    return;
  }
  console.log(chalk.green(`Removed captain task "${name}".`));
}

export async function captainRunCommand(name: string) {
  const task = await getCaptainTask(name);
  if (!task) {
    throw new Error(`No captain task named "${name}". Run: ctxhub captain list`);
  }

  const record = await runCaptainTask(task);
  console.log(chalk.green(`Ran captain task "${name}" (run ${record.runId}) against workspace "${record.workspace}".`));
  for (const line of record.result.answer) console.log(`- ${line}`);
  if (record.result.llmNotice) console.log(chalk.dim(record.result.llmNotice));
  console.log(chalk.gray(`Pending review. Promote with: ctxhub captain promote ${name} ${record.runId} <repo>`));
}

export async function captainApprovalsCommand(name: string) {
  const runs = await listCaptainRuns(name);
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
