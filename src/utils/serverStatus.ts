import fs from 'node:fs';
import { getPackageVersion } from './version.js';

export type ServerStatus = {
  version: string;
  mode: 'installed' | 'dev';
  startedAt: string;
  builtAt?: string;
  stale: boolean;
  instructions: string;
};

type StatFn = (path: string) => { mtimeMs: number };

// Deliberately NOT based on package.json's semver: this repo (and most local dev/
// dogfooding setups) can rebuild `dist/` many times without ever bumping `version`,
// which would make a version-string comparison always report "not stale" even right
// after a real behavior change -- exactly the failure mode that motivated this check.
// `npm run build` does a full `clean && tsc`, so the running entry file's mtime moves
// on every real build regardless of whether package.json changed. If that file is
// newer than this process's own start time, the code on disk changed after this
// process loaded it into memory, and it's provably running stale code.
export function checkServerStaleness(
  startedAtMs: number,
  entryPath: string = process.argv[1] ?? '',
  statFn: StatFn = fs.statSync
): ServerStatus {
  const version = getPackageVersion();
  const startedAt = new Date(startedAtMs).toISOString();
  const isInstalled = /[/\\]dist[/\\]/.test(entryPath);

  if (!isInstalled) {
    return {
      version,
      mode: 'dev',
      startedAt,
      stale: false,
      instructions: 'Running from source in dev mode (tsx) -- this always reflects the current source, so staleness does not apply.'
    };
  }

  try {
    const builtAtMs = statFn(entryPath).mtimeMs;
    const stale = builtAtMs > startedAtMs;
    return {
      version,
      mode: 'installed',
      startedAt,
      builtAt: new Date(builtAtMs).toISOString(),
      stale,
      instructions: stale
        ? 'This MCP server process was started before the last ctxhub build/install and may be running out-of-date ' +
          'code. ctxhub cannot restart itself -- only the client/harness that launched it can. Tell the user this ' +
          'connection is stale and ask them to restart it (reconnect the ctxhub MCP server, or restart the agent/' +
          'harness) so it relaunches with the current version.'
        : 'Running the current build. No action needed.'
    };
  } catch {
    return {
      version,
      mode: 'installed',
      startedAt,
      stale: false,
      instructions: 'Could not read the running entry file to check its build time; staleness could not be determined.'
    };
  }
}
