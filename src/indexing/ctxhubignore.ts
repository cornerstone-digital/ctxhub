import path from 'node:path';
import { pathExists, readText } from '../utils/fs.js';

export const CTXHUBIGNORE_FILE = '.ctxhubignore';

/**
 * Default patterns that are always applied, even if no .ctxhubignore file exists.
 * Written in fast-glob compatible glob format.
 */
export const DEFAULT_CTXHUBIGNORE_PATTERNS: string[] = [
  '**/.env',
  '**/.env.*',
  '**/*.key',
  '**/*.pem',
  '**/*.p12',
  '**/*.pfx',
  '**/secrets/**',
  '**/.git/**',
  '**/node_modules/**',
  '**/dist/**',
];

/**
 * The default content written to a new .ctxhubignore file.
 * Human-readable with comments; patterns are in gitignore/glob style.
 */
export function defaultCtxhubIgnoreContent(): string {
  return [
    '# .ctxhubignore — files matching these patterns are never indexed',
    '# Syntax: gitignore-style glob patterns. Lines starting with # are comments.',
    '',
    '# Secrets and credentials',
    '.env',
    '.env.*',
    '*.key',
    '*.pem',
    '*.p12',
    '*.pfx',
    'secrets/',
    '',
    '# Version control and build output',
    '.git/',
    'node_modules/',
    'dist/',
    '',
  ].join('\n');
}

/**
 * Parse a .ctxhubignore file content into an array of glob patterns,
 * stripping blank lines and comment lines (# prefix).
 * Patterns are normalised for fast-glob: directory patterns ending with "/"
 * become a double-star glob, plain filename patterns get a double-star prefix
 * so they match at any depth (mirrors how git treats patterns without a leading slash).
 */
export function parseCtxhubIgnoreContent(content: string): string[] {
  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'))
    .map(normalisePattern);
}

function normalisePattern(pattern: string): string {
  // Directory-only pattern (e.g. "secrets/") → "**/secrets/**"
  if (pattern.endsWith('/')) {
    const name = pattern.slice(0, -1);
    // Already anchored (starts with /) → strip leading slash, keep as glob
    if (name.startsWith('/')) return `${name.slice(1)}/**`;
    return `**/${name}/**`;
  }

  // Already a full glob (contains **) or anchored (starts with /) — pass through
  if (pattern.includes('**') || pattern.startsWith('/')) return pattern;

  // Contains a slash but not leading → treat as anchored path (e.g. "build/output.txt")
  if (pattern.includes('/')) return pattern;

  // Plain filename or extension glob (e.g. "*.pem", ".env") → match at any depth
  return `**/${pattern}`;
}

/**
 * Load all patterns to ignore for a workspace: the hardcoded defaults plus
 * any patterns from a .ctxhubignore file at the workspace root.
 * Skipped files are logged at debug level by the caller.
 */
export async function loadCtxhubIgnorePatterns(workspaceRoot: string): Promise<string[]> {
  const patterns = [...DEFAULT_CTXHUBIGNORE_PATTERNS];

  const ignorePath = path.join(workspaceRoot, CTXHUBIGNORE_FILE);
  if (!(await pathExists(ignorePath))) {
    return patterns;
  }

  try {
    const content = await readText(ignorePath);
    const filePatterns = parseCtxhubIgnoreContent(content);
    patterns.push(...filePatterns);
    if (process.env.CTXHUB_DEBUG) {
      console.debug(`[ctxhubignore] loaded ${filePatterns.length} pattern(s) from ${ignorePath}`);
    }
  } catch (err) {
    // Non-fatal: log at debug level and continue without file patterns
    if (process.env.CTXHUB_DEBUG) {
      console.debug(`[ctxhubignore] could not read ${ignorePath}: ${err}`);
    }
  }

  return patterns;
}
