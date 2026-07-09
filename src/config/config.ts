import path from 'node:path';
import yaml from 'js-yaml';
import { defaultConfig } from './defaultConfig.js';
import type { SsdConfig } from './types.js';
import { ensureDir, pathExists, readText, writeText } from '../utils/fs.js';

export const SSD_DIR = '.ssd';
export const LOCAL_CONFIG_PATH = 'ssd.yaml';
export const PROJECT_CONFIG_PATH = path.join(SSD_DIR, 'config.yaml');
export const CONFIG_PATH = PROJECT_CONFIG_PATH;
export const INDEX_DIR = path.join(SSD_DIR, 'index');
export const CACHE_DIR = path.join(SSD_DIR, 'cache');
export const MEMORY_DIR = path.join(SSD_DIR, 'memory');

const CONFIG_CANDIDATES = [LOCAL_CONFIG_PATH, PROJECT_CONFIG_PATH];

export async function findConfigPath(cwd = process.cwd()): Promise<string | undefined> {
  for (const candidate of CONFIG_CANDIDATES) {
    const fullPath = path.join(cwd, candidate);
    if (await pathExists(fullPath)) return fullPath;
  }

  return undefined;
}

export function relativeConfigPath(configPath: string, cwd = process.cwd()): string {
  return path.relative(cwd, configPath) || path.basename(configPath);
}

export async function loadConfig(cwd = process.cwd()): Promise<SsdConfig> {
  const fullPath = await findConfigPath(cwd);
  if (!fullPath) {
    throw new Error(`No SSD config found. Expected ${LOCAL_CONFIG_PATH} or ${PROJECT_CONFIG_PATH}. Run: ssd init`);
  }

  const raw = await readText(fullPath);
  const parsed = (yaml.load(raw) ?? {}) as Partial<SsdConfig>;

  return {
    ...defaultConfig,
    ...parsed,
    workspace: { ...defaultConfig.workspace, ...parsed.workspace },
    knowledge: { ...defaultConfig.knowledge, ...parsed.knowledge },
    memory: { ...defaultConfig.memory, ...parsed.memory },
    index: { ...defaultConfig.index, ...parsed.index },
    repositories: parsed.repositories ?? []
  };
}

export async function saveConfig(config: SsdConfig, cwd = process.cwd()): Promise<void> {
  const fullPath = await findConfigPath(cwd) ?? path.join(cwd, PROJECT_CONFIG_PATH);
  await writeText(fullPath, yaml.dump(config, { lineWidth: 120 }));
}

export async function initConfig(workspaceName: string, cwd = process.cwd()): Promise<void> {
  const config = structuredClone(defaultConfig);
  config.workspace.name = workspaceName;
  await ensureDir(path.join(cwd, INDEX_DIR));
  await ensureDir(path.join(cwd, CACHE_DIR));
  await ensureDir(path.join(cwd, MEMORY_DIR));
  await saveConfig(config, cwd);
}
