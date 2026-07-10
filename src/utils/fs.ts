import { mkdir, readFile, writeFile, access, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

export async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}

export async function readText(target: string): Promise<string> {
  return readFile(target, 'utf8');
}

export async function writeText(target: string, content: string): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, content, 'utf8');
    await rename(tmp, target);
  } catch (err) {
    // Clean up tmp file on failure (best-effort)
    try { await unlink(tmp); } catch { /* best-effort, ignore */ }
    throw err;
  }
}
