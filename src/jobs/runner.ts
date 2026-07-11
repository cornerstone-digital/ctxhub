import { randomBytes } from 'node:crypto';
import { listWorkspaces } from '../workspaces/registry.js';
import { loadWorkspaceConfig } from '../config/config.js';
import { createExplainResult } from '../commands/explain.js';
import { eventBus } from '../events/eventBus.js';
import { getCaptainTask } from '../captains/tasks.js';
import { writeDiaryMempalace } from '../memory/mempalaceCli.js';
import { saveJobRun } from './jobStore.js';
import type { JobDefinition, JobRun, JobStep } from './types.js';

function makeJobId(): string {
  // ISO timestamp with colons replaced (safe for filenames) + 3 random hex bytes
  return `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(3).toString('hex')}`;
}

// Replaces {prev.answer} with the immediately prior step's answer, and
// {steps.<name>.answer} with any named prior step's answer. Template variables
// left unfulfilled (e.g. a forward reference, or a typo) are left as-is so the
// LLM sees them literally rather than silently receiving a blank string.
function interpolate(query: string, prevAnswer: string | null, stepAnswers: Map<string, string>): string {
  let q = query;
  if (prevAnswer !== null) q = q.replaceAll('{prev.answer}', prevAnswer);
  for (const [name, answer] of stepAnswers) {
    q = q.replaceAll(`{steps.${name}.answer}`, answer);
  }
  return q;
}

// Resolves a step definition against a referenced captain task (if any).
// Inline fields always win over the captain task's defaults.
async function resolveStep(step: JobStep): Promise<JobStep> {
  if (!step.captainTask) return step;
  const task = await getCaptainTask(step.captainTask);
  if (!task) return step;
  return {
    ...step,
    workspace: step.workspace || task.workspace,
    query:     step.query     || task.query,
    persona:   step.persona   ?? task.persona,
    profile:   step.profile   ?? task.profile,
  };
}

// Runs a job sequentially, publishing job.* events for every state transition.
// All persistence is done via saveJobRun so the UI can observe progress via
// GET /job-runs/:jobId (polling) or the SSE stream (/events).
export async function runJob(def: JobDefinition, jobId = makeJobId()): Promise<JobRun> {
  const workspaces = await listWorkspaces();

  const run: JobRun = {
    jobId,
    job: def.name,
    status: 'queued',
    startedAt: new Date().toISOString(),
    steps: def.steps.map(s => ({ stepName: s.name, status: 'pending' })),
  };

  await saveJobRun(run);
  eventBus.publish({ type: 'job.queued', jobId, job: def.name });

  run.status = 'running';
  eventBus.publish({ type: 'job.started', jobId, job: def.name });
  await saveJobRun(run);

  const stepAnswers = new Map<string, string>();
  let prevAnswer: string | null = null;

  for (let i = 0; i < def.steps.length; i++) {
    const stepDef = await resolveStep(def.steps[i]);
    const stepRun = run.steps[i];

    const workspace = workspaces.find(ws => ws.name === stepDef.workspace);
    if (!workspace?.exists) {
      const error = `Workspace "${stepDef.workspace}" not found or doesn't exist`;
      stepRun.status = 'failed';
      stepRun.startedAt = new Date().toISOString();
      stepRun.completedAt = stepRun.startedAt;
      stepRun.error = error;
      run.status = 'failed';
      run.completedAt = stepRun.completedAt;

      eventBus.publish({ type: 'job.step.started',  jobId, job: def.name, step: def.steps[i].name, stepIndex: i });
      eventBus.publish({ type: 'job.step.failed',   jobId, job: def.name, step: def.steps[i].name, stepIndex: i, error });
      eventBus.publish({ type: 'job.failed',        jobId, job: def.name, error });
      await saveJobRun(run);
      return run;
    }

    const resolvedQuery = interpolate(stepDef.query, prevAnswer, stepAnswers);
    stepRun.input = resolvedQuery;
    stepRun.status = 'running';
    stepRun.startedAt = new Date().toISOString();

    eventBus.publish({ type: 'job.step.started', jobId, job: def.name, step: def.steps[i].name, stepIndex: i });
    await saveJobRun(run);

    try {
      const result = await createExplainResult(resolvedQuery, 8, workspace.path, {
        persona: stepDef.persona,
        profile: stepDef.profile,
      });

      stepRun.status = 'completed';
      stepRun.completedAt = new Date().toISOString();
      stepRun.result = {
        answer:    result.answer,
        citations: result.citations,
        llmNotice: result.llmNotice,
      };

      const answerText = result.answer.join('\n');
      prevAnswer = answerText;
      stepAnswers.set(def.steps[i].name, answerText);

      // Persist step answer to MemPalace when flagged, so it becomes searchable knowledge.
      // Best-effort: a MemPalace write failure never kills the job.
      if (stepDef.persist) {
        try {
          const { config, workspaceRoot } = await loadWorkspaceConfig(workspace.path);
          await writeDiaryMempalace(config, workspaceRoot, {
            agentName: `job/${def.name}/${stepDef.name}`,
            entry: answerText,
            topic: stepDef.name,
            wing: def.name,
          });
        } catch {
          // Swallow — MemPalace may not be configured; don't fail the job over it.
        }
      }

      eventBus.publish({ type: 'job.step.completed', jobId, job: def.name, step: def.steps[i].name, stepIndex: i });
      await saveJobRun(run);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      stepRun.status = 'failed';
      stepRun.completedAt = new Date().toISOString();
      stepRun.error = error;
      run.status = 'failed';
      run.completedAt = stepRun.completedAt;

      eventBus.publish({ type: 'job.step.failed', jobId, job: def.name, step: def.steps[i].name, stepIndex: i, error });
      eventBus.publish({ type: 'job.failed',      jobId, job: def.name, error });
      await saveJobRun(run);
      return run;
    }
  }

  run.status = 'completed';
  run.completedAt = new Date().toISOString();
  eventBus.publish({ type: 'job.completed', jobId, job: def.name });
  await saveJobRun(run);
  return run;
}

// Fire-and-forget: allocates a jobId, kicks off execution in the background,
// and returns the jobId immediately so the HTTP handler can respond with it.
// All progress arrives via the SSE event stream.
export function startJobBackground(def: JobDefinition): string {
  const jobId = makeJobId();
  void runJob(def, jobId).catch(err => {
    // Last-resort console log — by this point all step-level errors are already
    // handled inside runJob and published to the event bus.
    console.error(`[jobs] Unhandled error in job ${jobId}:`, err);
  });
  return jobId;
}
