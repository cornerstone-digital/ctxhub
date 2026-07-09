import path from 'node:path';
import { execa } from '../utils/execa-lite.js';

export async function runGit(args: string[], cwd: string): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trim();
}

export async function isGitInstalled(): Promise<boolean> {
  try {
    await execa('git', ['--version']);
    return true;
  } catch {
    return false;
  }
}

export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--is-inside-work-tree'], repoPath);
    return true;
  } catch {
    return false;
  }
}

export async function getCurrentCommit(repoPath: string): Promise<string | undefined> {
  try {
    return await runGit(['rev-parse', 'HEAD'], repoPath);
  } catch {
    return undefined;
  }
}

export async function pullRepo(repoPath: string): Promise<void> {
  await runGit(['pull', '--ff-only'], repoPath);
}

export function getRepoName(repoPath: string): string {
  return path.basename(path.resolve(repoPath));
}
