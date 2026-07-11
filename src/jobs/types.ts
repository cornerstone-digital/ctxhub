import path from 'node:path';
import { getCtxhubHome } from '../workspaces/registry.js';

// A step is a single agent call within a job — one workspace, one query (potentially with
// interpolated prior-step context), one optional persona/profile. A step can optionally reference
// an existing captain task definition by name (`captainTask`) in which case that task's
// workspace/query/persona are used as defaults that the inline fields override.
export type JobStep = {
  name: string;          // "audit", "draft-fixes", "security-check"
  workspace: string;     // registered workspace name
  query: string;         // supports {prev.answer} and {steps.<name>.answer} interpolation
  persona?: string;
  profile?: string;
  captainTask?: string;  // optional: inherit defaults from an existing captain task definition
  // When true, the step's answer is written to MemPalace after successful completion so it
  // becomes searchable institutional knowledge rather than sitting only in the run record.
  persist?: boolean;
};

export type JobDefinition = {
  name: string;
  description?: string;
  steps: JobStep[];
  schedule?: { everyMinutes: number };
};

export type JobDefinitionFile = {
  version: 1;
  jobs: JobDefinition[];
};

export type JobStepStatus = 'pending' | 'running' | 'completed' | 'failed';
export type JobStatus = 'queued' | 'running' | 'completed' | 'failed';

export type JobStepRun = {
  stepName: string;
  status: JobStepStatus;
  startedAt?: string;
  completedAt?: string;
  input?: string;         // the resolved query (after interpolation) actually sent to the LLM
  result?: {
    answer: string[];
    citations: Array<{ ref: string; repo: string; path: string; title?: string }>;
    llmNotice?: string;
  };
  error?: string;
};

export type JobRun = {
  jobId: string;
  job: string;            // JobDefinition.name
  status: JobStatus;
  startedAt: string;
  completedAt?: string;
  steps: JobStepRun[];
};

export function getJobsPath(): string {
  return path.join(getCtxhubHome(), 'jobs.json');
}

export function getJobRunsDir(): string {
  return path.join(getCtxhubHome(), 'job-runs');
}
