import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
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
  await ensureDir(path.dirname(target));
  await writeFile(target, content, 'utf8');
}
