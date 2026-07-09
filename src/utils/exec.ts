import { execa } from './execa-lite.js';

/** @deprecated Use src/git/git.ts helpers for git operations. */
export async function git(args: string[], cwd: string): Promise<string> {
  const result = await execa('git', args, { cwd });
  return result.stdout.trim();
}
