import chalk from 'chalk';
import { addJobDefinition, getJobDefinition, listJobRuns, loadJobDefinitions, removeJobDefinition } from '../jobs/jobStore.js';
import { runJob } from '../jobs/runner.js';
import type { JobDefinition, JobStep } from '../jobs/types.js';

export async function jobListCommand() {
  const { jobs } = await loadJobDefinitions();
  if (!jobs.length) {
    console.log(chalk.yellow('No jobs defined. Run: ctxhub job add <name> --step "name:workspace:query"'));
    return;
  }
  for (const job of jobs) {
    const extras = [
      job.description ? chalk.gray(`"${job.description}"`) : undefined,
      job.schedule ? chalk.gray(`every=${job.schedule.everyMinutes}m`) : undefined,
    ].filter(Boolean).join(' ');
    console.log(`${chalk.green('✓')} ${chalk.bold(job.name)} (${job.steps.length} step${job.steps.length === 1 ? '' : 's'}) ${extras}`);
    for (const step of job.steps) {
      console.log(`    ${chalk.cyan(step.name)} → ${step.workspace} ${chalk.gray(`"${step.query.slice(0, 60)}${step.query.length > 60 ? '…' : ''}"`)}`);
    }
  }
}

export async function jobAddCommand(
  name: string,
  opts: {
    description?: string;
    step?: string[];           // "stepname:workspace:query"
    scheduleEveryMinutes?: string;
  }
) {
  const rawSteps = opts.step ?? [];
  if (!rawSteps.length) {
    throw new Error('At least one --step is required. Format: --step "name:workspace:query"');
  }

  const steps: JobStep[] = rawSteps.map((s, i) => {
    const colonIdx = s.indexOf(':');
    const secondColon = s.indexOf(':', colonIdx + 1);
    if (colonIdx === -1 || secondColon === -1) {
      throw new Error(`--step "${s}" is not in the required format "name:workspace:query"`);
    }
    const stepName = s.slice(0, colonIdx).trim();
    const workspace = s.slice(colonIdx + 1, secondColon).trim();
    const query = s.slice(secondColon + 1).trim();
    if (!stepName || !workspace || !query) {
      throw new Error(`--step at index ${i} is missing name, workspace, or query`);
    }
    return { name: stepName, workspace, query };
  });

  const everyMinutes = opts.scheduleEveryMinutes ? Number(opts.scheduleEveryMinutes) : undefined;
  if (everyMinutes !== undefined && (!Number.isFinite(everyMinutes) || everyMinutes < 1)) {
    throw new Error('--schedule-every-minutes must be a positive integer >= 1');
  }

  const job: JobDefinition = {
    name,
    description: opts.description,
    steps,
    schedule: everyMinutes ? { everyMinutes } : undefined,
  };

  await addJobDefinition(job);
  console.log(chalk.green(`Added job "${name}" with ${steps.length} step(s).`));
  if (everyMinutes) {
    console.log(chalk.gray(`Scheduled: runs every ${everyMinutes} minute(s) while \`ctxhub service\` is running.`));
  }
  console.log(chalk.gray('Run it now: ctxhub job run ' + name));
}

export async function jobRemoveCommand(name: string) {
  const removed = await removeJobDefinition(name);
  if (!removed) {
    console.log(chalk.yellow(`No job named "${name}".`));
    return;
  }
  console.log(chalk.green(`Removed job "${name}".`));
}

export async function jobRunCommand(name: string) {
  const job = await getJobDefinition(name);
  if (!job) {
    throw new Error(`No job named "${name}". Run: ctxhub job list`);
  }

  console.log(chalk.bold(`Running job "${name}" (${job.steps.length} step${job.steps.length === 1 ? '' : 's'})...`));
  console.log('');

  const run = await runJob(job);

  for (const step of run.steps) {
    const icon = step.status === 'completed' ? chalk.green('✓')
               : step.status === 'failed'    ? chalk.red('✗')
               : chalk.yellow('?');
    const dur = step.startedAt && step.completedAt
      ? chalk.gray(` (${Math.round((new Date(step.completedAt).getTime() - new Date(step.startedAt).getTime()) / 1000)}s)`)
      : '';
    console.log(`  ${icon} ${step.stepName}${dur}`);

    if (step.result?.answer.length) {
      for (const line of step.result.answer) console.log(`      ${chalk.gray('–')} ${line}`);
    }
    if (step.error) {
      console.log(`      ${chalk.red('Error:')} ${step.error}`);
    }
  }

  console.log('');
  if (run.status === 'completed') {
    console.log(chalk.green('✓ Job completed.'));
  } else {
    console.log(chalk.red(`✗ Job failed at step "${run.steps.find(s => s.status === 'failed')?.stepName ?? '?'}".`));
  }
}

export async function jobRunsCommand(name?: string) {
  const runs = await listJobRuns(20);
  const filtered = name ? runs.filter(r => r.job === name) : runs;

  if (!filtered.length) {
    console.log(chalk.yellow(name ? `No runs for job "${name}".` : 'No job runs yet.'));
    return;
  }

  for (const run of filtered) {
    const icon = run.status === 'completed' ? chalk.green('✓')
               : run.status === 'failed'    ? chalk.red('✗')
               : run.status === 'running'   ? chalk.cyan('▶')
               : chalk.gray('⏳');
    const dur = run.completedAt
      ? chalk.gray(` (${Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)}s)`)
      : '';
    console.log(`${icon} ${chalk.bold(run.job)} ${chalk.gray(run.jobId)}${dur}`);
    console.log(`   ${run.steps.map(s => (s.status === 'completed' ? chalk.green(s.stepName) : s.status === 'failed' ? chalk.red(s.stepName) : chalk.gray(s.stepName))).join(' → ')}`);
  }
}
