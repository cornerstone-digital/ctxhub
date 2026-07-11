import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { ensureDir, pathExists, readText, writeText } from '../utils/fs.js';
import { type JobDefinition, type JobDefinitionFile, type JobRun, getJobsPath, getJobRunsDir } from './types.js';

// ── Job definitions ─────────────────────────────────────────────────────────

export async function loadJobDefinitions(jobsPath = getJobsPath()): Promise<JobDefinitionFile> {
  if (!(await pathExists(jobsPath))) return { version: 1, jobs: [] };
  const raw = await readText(jobsPath);
  const parsed = JSON.parse(raw) as Partial<JobDefinitionFile>;
  return { version: 1, jobs: parsed.jobs ?? [] };
}

export async function saveJobDefinitions(file: JobDefinitionFile, jobsPath = getJobsPath()): Promise<void> {
  await writeText(jobsPath, `${JSON.stringify(file, null, 2)}\n`);
}

// Upsert: if a job with this name already exists it is replaced, not rejected.
export async function addJobDefinition(job: JobDefinition, jobsPath = getJobsPath()): Promise<void> {
  const file = await loadJobDefinitions(jobsPath);
  const idx = file.jobs.findIndex(j => j.name === job.name);
  if (idx !== -1) {
    file.jobs[idx] = job;
  } else {
    file.jobs.push(job);
  }
  await saveJobDefinitions(file, jobsPath);
}

export async function removeJobDefinition(name: string, jobsPath = getJobsPath()): Promise<boolean> {
  const file = await loadJobDefinitions(jobsPath);
  const idx = file.jobs.findIndex(j => j.name === name);
  if (idx === -1) return false;
  file.jobs.splice(idx, 1);
  await saveJobDefinitions(file, jobsPath);
  return true;
}

export async function getJobDefinition(name: string, jobsPath = getJobsPath()): Promise<JobDefinition | undefined> {
  const file = await loadJobDefinitions(jobsPath);
  return file.jobs.find(j => j.name === name);
}

// ── Job run records ─────────────────────────────────────────────────────────

export async function saveJobRun(run: JobRun): Promise<void> {
  const runsDir = getJobRunsDir();
  await ensureDir(runsDir);
  await writeText(path.join(runsDir, `${run.jobId}.json`), `${JSON.stringify(run, null, 2)}\n`);
}

export async function loadJobRun(jobId: string): Promise<JobRun | undefined> {
  const filePath = path.join(getJobRunsDir(), `${jobId}.json`);
  if (!(await pathExists(filePath))) return undefined;
  return JSON.parse(await readText(filePath)) as JobRun;
}

// Returns the most recent `limit` runs across all jobs, sorted newest-first.
// Filenames start with an ISO timestamp (hyphens instead of colons) so
// alphabetical-descending order is chronological-descending.
export async function listJobRuns(limit = 50): Promise<JobRun[]> {
  const runsDir = getJobRunsDir();
  if (!(await pathExists(runsDir))) return [];

  const files = (await readdir(runsDir))
    .filter(f => f.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit);

  return Promise.all(
    files.map(async f => JSON.parse(await readText(path.join(runsDir, f))) as JobRun)
  );
}
