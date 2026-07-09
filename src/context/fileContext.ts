import path from 'node:path';
import type { CtxhubConfig } from '../config/types.js';
import { readText } from '../utils/fs.js';

export type FileContext = {
  repo: string;
  path: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  content: string;
};

export async function getFileContext(
  config: CtxhubConfig,
  repoName: string,
  filePath: string,
  opts: { line?: number; before?: number; after?: number } = {},
  cwd = process.cwd()
): Promise<FileContext> {
  const repo = config.repositories.find(candidate => candidate.name === repoName);
  if (!repo) throw new Error(`Repository not found: ${repoName}`);

  const absolutePath = path.resolve(cwd, repo.path, filePath);
  const content = await readText(absolutePath);
  const lines = content.split('\n');
  const line = Math.min(Math.max(opts.line ?? 1, 1), lines.length);
  const before = opts.before ?? 40;
  const after = opts.after ?? 80;
  const startLine = Math.max(1, line - before);
  const endLine = Math.min(lines.length, line + after);

  return {
    repo: repoName,
    path: filePath,
    startLine,
    endLine,
    totalLines: lines.length,
    content: lines.slice(startLine - 1, endLine).join('\n')
  };
}
