import os from 'node:os';
import path from 'node:path';
import { loadWorkspaceConfig } from '../config/config.js';
import { pathExists, readText, writeText } from '../utils/fs.js';

// docs/control-plane.md Phase 1: a user-level pointer list, not a second copy of workspace state.
// Each workspace keeps owning its own config/index/memory/personas exactly as today -- the
// registry only remembers where a workspace is and what it's called.
// Functions, not module-level constants, so CTXHUB_HOME can be overridden per call (tests) without
// depending on when this module happened to first load.
export function getCtxhubHome(): string {
  return process.env.CTXHUB_HOME || path.join(os.homedir(), '.ctxhub');
}

export function getRegistryPath(): string {
  return path.join(getCtxhubHome(), 'registry.json');
}

export type WorkspaceRegistryEntry = {
  name: string;
  path: string;
  addedAt: string;
};

export type WorkspaceRegistry = {
  version: 1;
  workspaces: WorkspaceRegistryEntry[];
};

export const EMPTY_REGISTRY: WorkspaceRegistry = { version: 1, workspaces: [] };

export async function loadRegistry(registryPath = getRegistryPath()): Promise<WorkspaceRegistry> {
  if (!(await pathExists(registryPath))) return { version: 1, workspaces: [] };

  const raw = await readText(registryPath);
  const parsed = JSON.parse(raw) as Partial<WorkspaceRegistry>;
  return { version: 1, workspaces: parsed.workspaces ?? [] };
}

export async function saveRegistry(registry: WorkspaceRegistry, registryPath = getRegistryPath()): Promise<void> {
  await writeText(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

// Registering the same workspace path twice is a no-op (returns the existing entry) rather than
// an error -- re-running `ctxhub workspace register` from muscle memory shouldn't fail.
export async function registerWorkspace(
  targetPath: string,
  name?: string,
  registryPath = getRegistryPath()
): Promise<WorkspaceRegistryEntry> {
  const { config, workspaceRoot } = await loadWorkspaceConfig(targetPath);
  const registry = await loadRegistry(registryPath);

  const existingByPath = registry.workspaces.find(entry => path.resolve(entry.path) === path.resolve(workspaceRoot));
  if (existingByPath) return existingByPath;

  const resolvedName = name ?? config.workspace.name;
  if (registry.workspaces.some(entry => entry.name === resolvedName)) {
    throw new Error(`A workspace named "${resolvedName}" is already registered. Pass an explicit name to disambiguate.`);
  }

  const entry: WorkspaceRegistryEntry = { name: resolvedName, path: workspaceRoot, addedAt: new Date().toISOString() };
  registry.workspaces.push(entry);
  await saveRegistry(registry, registryPath);
  return entry;
}

export type WorkspaceStatus = WorkspaceRegistryEntry & { exists: boolean };

// Reports missing paths rather than silently pruning them -- matches ctxhub doctor's existing
// "report, don't silently fix" bias for anything that could discard a user's own registration.
export async function listWorkspaces(registryPath = getRegistryPath()): Promise<WorkspaceStatus[]> {
  const registry = await loadRegistry(registryPath);
  const results: WorkspaceStatus[] = [];
  for (const entry of registry.workspaces) {
    results.push({ ...entry, exists: await pathExists(entry.path) });
  }
  return results;
}

export async function removeWorkspace(name: string, registryPath = getRegistryPath()): Promise<boolean> {
  const registry = await loadRegistry(registryPath);
  const index = registry.workspaces.findIndex(entry => entry.name === name);
  if (index === -1) return false;

  registry.workspaces.splice(index, 1);
  await saveRegistry(registry, registryPath);
  return true;
}
