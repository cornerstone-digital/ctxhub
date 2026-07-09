import path from 'node:path';
import { loadConfig } from '../config/config.js';
import type { CtxhubConfig } from '../config/types.js';
import { getCurrentCommit } from '../git/git.js';
import { getPackageVersion } from '../utils/version.js';

export type ContextPackArtifact = {
  schemaVersion: 1;
  ctxhubVersion: string;
  exportedAt: string;
  query: string;
  workspace: string;
  cwd?: string;
  repoHeads: Record<string, string | undefined>;
  pack: unknown;
};

export type ReplayFreshness = {
  repo: string;
  exportedCommit?: string;
  currentCommit?: string;
  stale: boolean;
  reason?: string;
};

export async function createContextPackArtifact(
  pack: { query: string; workspace: string },
  opts: { includeAbsolutePaths?: boolean; cwd?: string } = {}
): Promise<ContextPackArtifact> {
  const cwd = opts.cwd ?? process.cwd();
  const config = await loadConfig(cwd);
  const repoHeads = await collectRepoHeads(config, cwd);

  return {
    schemaVersion: 1,
    ctxhubVersion: getPackageVersion(),
    exportedAt: new Date().toISOString(),
    query: pack.query,
    workspace: pack.workspace,
    cwd: opts.includeAbsolutePaths ? cwd : undefined,
    repoHeads,
    pack: opts.includeAbsolutePaths ? pack : stripAbsolutePaths(pack)
  };
}

export async function replayFreshnessForArtifact(
  artifact: ContextPackArtifact,
  cwd = process.cwd()
): Promise<ReplayFreshness[]> {
  let config: CtxhubConfig;
  try {
    config = await loadConfig(cwd);
  } catch {
    return Object.entries(artifact.repoHeads).map(([repo, exportedCommit]) => ({
      repo,
      exportedCommit,
      stale: false,
      reason: 'No local ctxhub config found; current repo freshness was not checked.'
    }));
  }

  const currentHeads = await collectRepoHeads(config, cwd);
  return Object.entries(artifact.repoHeads).map(([repo, exportedCommit]) => {
    const currentCommit = currentHeads[repo];
    return {
      repo,
      exportedCommit,
      currentCommit,
      stale: Boolean(exportedCommit && currentCommit && exportedCommit !== currentCommit),
      reason: currentCommit ? undefined : 'Repo is not configured locally or has no current commit.'
    };
  });
}

export function parseContextPackArtifact(raw: string): ContextPackArtifact {
  const parsed = JSON.parse(raw) as Partial<ContextPackArtifact>;
  if (parsed.schemaVersion !== 1 || !parsed.pack || !parsed.query || !parsed.workspace) {
    throw new Error('Invalid ctxhub context pack artifact.');
  }
  return parsed as ContextPackArtifact;
}

export function stripAbsolutePaths(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(item => stripAbsolutePaths(item));
  if (!value || typeof value !== 'object') return value;

  const next: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'absolutePath') continue;
    next[key] = stripAbsolutePaths(nested);
  }
  return next;
}

async function collectRepoHeads(config: CtxhubConfig, cwd: string): Promise<Record<string, string | undefined>> {
  const entries = await Promise.all(config.repositories.map(async repo => {
    const repoPath = path.resolve(cwd, repo.path);
    return [repo.name, await getCurrentCommit(repoPath)] as const;
  }));
  return Object.fromEntries(entries);
}
