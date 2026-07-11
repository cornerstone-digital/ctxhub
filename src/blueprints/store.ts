import path from 'node:path';
import { getCtxhubHome } from '../workspaces/registry.js';
import { pathExists, readText, writeText } from '../utils/fs.js';
import type { BlueprintStore, InstalledBlueprint } from './types.js';

export function getBlueprintHome(): string {
  return path.join(getCtxhubHome(), 'blueprints');
}

export function getBlueprintStorePath(): string {
  return path.join(getBlueprintHome(), 'blueprints.json');
}

export async function loadBlueprintStore(): Promise<BlueprintStore> {
  const storePath = getBlueprintStorePath();
  if (!(await pathExists(storePath))) {
    return { version: 1, installed: [] };
  }
  try {
    const raw = await readText(storePath);
    return JSON.parse(raw) as BlueprintStore;
  } catch {
    return { version: 1, installed: [] };
  }
}

export async function saveBlueprintStore(store: BlueprintStore): Promise<void> {
  await writeText(getBlueprintStorePath(), `${JSON.stringify(store, null, 2)}\n`);
}

export async function findInstalled(name: string): Promise<InstalledBlueprint | undefined> {
  const store = await loadBlueprintStore();
  return store.installed.find(b => b.name === name);
}
