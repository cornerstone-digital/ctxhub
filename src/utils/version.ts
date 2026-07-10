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
