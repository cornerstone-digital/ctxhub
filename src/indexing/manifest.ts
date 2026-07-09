import path from 'node:path';
import type { Manifest } from '../config/types.js';
import { pathExists, readText, writeText } from '../utils/fs.js';

export const MANIFEST_PATH = path.join('.devctx', 'memory', 'manifest.json');

export async function loadManifest(workspace: string, cwd = process.cwd()): Promise<Manifest> {
  const fullPath = path.join(cwd, MANIFEST_PATH);
  if (!(await pathExists(fullPath))) return { version: 1, workspace, files: {} };
  return JSON.parse(await readText(fullPath)) as Manifest;
}

export async function saveManifest(manifest: Manifest, cwd = process.cwd()): Promise<void> {
  await writeText(path.join(cwd, MANIFEST_PATH), JSON.stringify(manifest, null, 2));
}

export function manifestKey(repo: string, filePath: string): string {
  return `${repo}:${filePath}`;
}
