import path from 'node:path';
import chalk from 'chalk';
import { findConfigPath, loadConfig } from '../config/config.js';
import { pathExists, readText, writeText } from './fs.js';
import { detectDrift, driftCount } from './drift.js';
import { getPackageVersion } from './version.js';

const VERSION_MARKER_PATH = path.join('.ctxhub', 'cache', 'last-checked-version');

// Commands where an unsolicited nudge would be unhelpful or unsafe to print:
// `mcp` talks JSON-RPC over stdout (this check only ever writes to stderr, but skipping
// it here avoids the extra work on a hot startup path); `init`/`onboard` set the
// workspace up fresh, nothing to be stale yet; `doctor` already reports this in detail.
const SKIP_COMMANDS = new Set(['mcp', 'init', 'onboard', 'doctor']);

// Runs the same drift checks as `ctxhub doctor`, but only once per ctxhub version rather
// than on every command invocation, and only a one-line nudge rather than doctor's full
// per-item detail. Silently does nothing outside a ctxhub workspace, or once this version
// has already been checked (whether or not anything was found stale) -- this is meant to
// catch "you just upgraded", not nag on every command forever.
export async function checkForDriftOnce(commandName: string, cwd = process.cwd()): Promise<void> {
  if (SKIP_COMMANDS.has(commandName)) return;

  const configPath = await findConfigPath(cwd);
  if (!configPath) return;

  const currentVersion = getPackageVersion();
  const markerPath = path.join(cwd, VERSION_MARKER_PATH);
  const lastChecked = (await pathExists(markerPath)) ? (await readText(markerPath)).trim() : undefined;
  if (lastChecked === currentVersion) return;

  try {
    const config = await loadConfig(cwd);
    const report = await detectDrift(config, cwd);
    const count = driftCount(report);

    if (count > 0) {
      console.error(
        chalk.yellow(
          `! ctxhub was upgraded to ${currentVersion} — ${count} installed skill/config item(s) may be outdated. ` +
          'Run `ctxhub doctor` for details.'
        )
      );
    }
  } catch {
    // Best-effort nudge only -- never let a failure here interrupt the actual command.
  }

  // Record that this version has been checked (found drift, found none, or errored)
  // so this doesn't re-run on every single command for the rest of this version's lifetime.
  await writeText(markerPath, currentVersion);
}
