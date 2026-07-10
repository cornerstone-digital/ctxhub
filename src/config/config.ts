import path from 'node:path';
import yaml from 'js-yaml';
import { defaultConfig } from './defaultConfig.js';
import type { CtxhubConfig } from './types.js';
import { ensureDir, pathExists, readText, writeText } from '../utils/fs.js';

export const CTXHUB_DIR = '.ctxhub';
export const LOCAL_CONFIG_PATH = 'ctxhub.yaml';
export const PROJECT_CONFIG_PATH = path.join(CTXHUB_DIR, 'config.yaml');
export const CONFIG_PATH = PROJECT_CONFIG_PATH;
export const INDEX_DIR = path.join(CTXHUB_DIR, 'index');
export const CACHE_DIR = path.join(CTXHUB_DIR, 'cache');
export const MEMORY_DIR = path.join(CTXHUB_DIR, 'memory');
export const STATS_PATH = path.join(CTXHUB_DIR, 'stats.json');

const CONFIG_CANDIDATES = [LOCAL_CONFIG_PATH, PROJECT_CONFIG_PATH];

export type WorkspaceConfig = {
  config: CtxhubConfig;
  configPath: string;
  workspaceRoot: string;
};

export async function findConfigPath(cwd = process.cwd()): Promise<string | undefined> {
  let current = path.resolve(cwd);

  while (true) {
    for (const candidate of CONFIG_CANDIDATES) {
      const fullPath = path.join(current, candidate);
      if (await pathExists(fullPath)) return fullPath;
    }

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

export function workspaceRootForConfig(configPath: string): string {
  const normalized = path.normalize(configPath);
  if (normalized.endsWith(path.normalize(PROJECT_CONFIG_PATH))) {
    return path.dirname(path.dirname(normalized));
  }

  return path.dirname(normalized);
}

export function relativeConfigPath(configPath: string, cwd = process.cwd()): string {
  return path.relative(cwd, configPath) || path.basename(configPath);
}

function mergeConfig(parsed: Partial<CtxhubConfig>): CtxhubConfig {
  return {
    ...defaultConfig,
    ...parsed,
    workspace: { ...defaultConfig.workspace, ...parsed.workspace },
    knowledge: { ...defaultConfig.knowledge, ...parsed.knowledge },
    memory: { ...defaultConfig.memory, ...parsed.memory },
    index: { ...defaultConfig.index, ...parsed.index },
    hooks: { ...defaultConfig.hooks, ...parsed.hooks },
    privacy: { ...defaultConfig.privacy, ...parsed.privacy },
    llm: { ...defaultConfig.llm, ...parsed.llm },
    executionProfiles: { ...defaultConfig.executionProfiles, ...parsed.executionProfiles },
    repositories: parsed.repositories ?? []
  };
}

export async function loadWorkspaceConfig(cwd = process.cwd()): Promise<WorkspaceConfig> {
  const fullPath = await findConfigPath(cwd);
  if (!fullPath) {
    throw new Error(`No ctxhub config found. Expected ${LOCAL_CONFIG_PATH} or ${PROJECT_CONFIG_PATH}. Run: ctxhub init`);
  }

  const raw = await readText(fullPath);
  const parsed = (yaml.load(raw) ?? {}) as Partial<CtxhubConfig>;
  return {
    config: mergeConfig(parsed),
    configPath: fullPath,
    workspaceRoot: workspaceRootForConfig(fullPath)
  };
}

export async function loadConfig(cwd = process.cwd()): Promise<CtxhubConfig> {
  return (await loadWorkspaceConfig(cwd)).config;
}

export async function saveConfig(config: CtxhubConfig, cwd = process.cwd()): Promise<void> {
  const fullPath = await findConfigPath(cwd) ?? path.join(cwd, PROJECT_CONFIG_PATH);
  await writeText(fullPath, yaml.dump(config, { lineWidth: 120 }));
}

export async function initConfig(workspaceName: string, cwd = process.cwd()): Promise<void> {
  const config = structuredClone(defaultConfig);
  config.workspace.name = workspaceName;
  await ensureDir(path.join(cwd, INDEX_DIR));
  await ensureDir(path.join(cwd, CACHE_DIR));
  await ensureDir(path.join(cwd, MEMORY_DIR));
  await writeText(path.join(cwd, PROJECT_CONFIG_PATH), yaml.dump(config, { lineWidth: 120 }));
}
