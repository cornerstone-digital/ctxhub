import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dist/utils/version.js and src/utils/version.ts are both two directories below the package root.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let _cached: string | undefined;
export function getPackageVersion(): string {
  if (_cached) return _cached;
  const pkg = JSON.parse(readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8')) as { version: string };
  _cached = pkg.version;
  return _cached;
}

/**
 * Fetch the latest published version of ctxhub from the npm registry.
 * Times out after 3 seconds.  Returns null on any failure (no network, rate limit, etc.).
 */
export async function fetchLatestNpmVersion(timeout = 3_000): Promise<string | null> {
  try {
    const signal = AbortSignal.timeout(timeout);
    const res = await fetch('https://registry.npmjs.org/ctxhub/latest', { signal });
    if (!res.ok) return null;
    const body = await res.json() as { version?: string };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

/**
 * Compare two semver strings. Returns:
 *  -1 if a < b
 *   0 if a === b
 *   1 if a > b
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const parse = (v: string) => v.replace(/^v/, '').split('.').map(Number);
  const [aMaj = 0, aMin = 0, aPat = 0] = parse(a);
  const [bMaj = 0, bMin = 0, bPat = 0] = parse(b);
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1;
  if (aMin !== bMin) return aMin < bMin ? -1 : 1;
  if (aPat !== bPat) return aPat < bPat ? -1 : 1;
  return 0;
}

/**
 * Check the local version against the npm registry and print the result.
 * Errors (network, parse) are printed as warnings; they never throw.
 */
export async function versionCheckCommand(): Promise<void> {
  const { default: chalk } = await import('chalk');
  const current = getPackageVersion();

  const latest = await fetchLatestNpmVersion();
  if (!latest) {
    console.log(`ctxhub v${current} — ${chalk.yellow('version check failed: could not reach npm registry')}`);
    return;
  }

  const cmp = compareSemver(current, latest);
  if (cmp >= 0) {
    console.log(`ctxhub v${current} — ${chalk.green('up to date')}`);
  } else {
    console.log(
      `ctxhub v${current} — ${chalk.yellow(`update available: v${latest}`)} (run: ${chalk.cyan('npm install -g ctxhub')})`
    );
  }
}
