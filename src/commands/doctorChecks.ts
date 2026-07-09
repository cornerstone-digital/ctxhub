import path from 'node:path';
import chalk from 'chalk';
import { INDEX_DIR, relativeConfigPath } from '../config/config.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig } from '../config/types.js';
import { ensureDir, pathExists } from '../utils/fs.js';
import { getCurrentCommit, isGitInstalled, isGitRepo } from '../git/git.js';
import { createIndexProvider } from '../indexing/providers.js';
import { createMemoryAdapter } from '../memory/LocalJsonMemory.js';
import { detectDrift } from '../utils/drift.js';

export type CheckStatus = 'ok' | 'warn' | 'error';
export type CheckLine = { status: CheckStatus; message: string };
export type DoctorCheck = { id: string; run: () => Promise<CheckLine[]> };

export const CHECK_LABELS: Record<string, string> = {
  node: 'Node.js',
  git: 'Git',
  config: 'Config',
  schema: 'Config schema',
  privacy: 'Privacy settings',
  'index-directory': 'Index directory',
  'index-provider': 'Index provider',
  'memory-provider': 'Memory provider',
  repos: 'Repositories',
  drift: 'Installed skills & agent configs'
};

// Order matches the original sequential doctorCommand implementation exactly, so the
// non-TTY (plain console.log) rendering path stays byte-for-byte identical.
export function buildDoctorChecks(config: CtxhubConfig, configPath: string): DoctorCheck[] {
  return [
    {
      id: 'node',
      run: async () => [{ status: 'ok', message: `Node ${process.version}` }]
    },
    {
      id: 'git',
      run: async () => {
        const installed = await isGitInstalled();
        return [{ status: installed ? 'ok' : 'error', message: installed ? 'Git installed' : 'Git is not installed' }];
      }
    },
    {
      id: 'config',
      run: async () => [
        { status: 'ok', message: `ctxhub config loaded: ${config.workspace.name} (${relativeConfigPath(configPath)})` }
      ]
    },
    {
      id: 'schema',
      run: async () => {
        if (config.version !== defaultConfig.version) {
          return [
            {
              status: 'warn',
              message:
                `Config schema is version ${config.version}, this ctxhub expects ${defaultConfig.version}. ` +
                'Review the config after upgrading, or re-run: ctxhub init --force'
            }
          ];
        }
        return [{ status: 'ok', message: `Config schema up to date (v${config.version})` }];
      }
    },
    {
      id: 'privacy',
      run: async () => {
        const lines: CheckLine[] = [];
        const riskyIncludes = config.knowledge.include.filter(
          pattern =>
            pattern.includes('.env') ||
            /(^|\/)\*\*\/\*$/.test(pattern) ||
            /(^|\/)\*\*\/\*\.\*$/.test(pattern) ||
            /\b(secret|secrets|private-key|private_key)\b/i.test(pattern)
        );
        if (riskyIncludes.length) {
          lines.push({
            status: 'warn',
            message: `Broad/risky include patterns present: ${riskyIncludes.join(', ')}. Redaction is enabled, but review ctxhub.yaml.`
          });
        }
        if (!config.privacy.redactPatterns.length) {
          lines.push({ status: 'warn', message: 'No privacy.redactPatterns configured; secrets in indexed docs will not be redacted.' });
        }
        return lines;
      }
    },
    {
      id: 'index-directory',
      run: async () => {
        try {
          await ensureDir(path.join(process.cwd(), INDEX_DIR));
          return [{ status: 'ok', message: 'Index directory writable' }];
        } catch (error) {
          return [{ status: 'error', message: `Index directory not writable: ${(error as Error).message}` }];
        }
      }
    },
    {
      id: 'index-provider',
      run: async () => {
        try {
          const index = createIndexProvider(config.index.provider, config.index.path, config.index.table);
          await index.status();
          return [{ status: 'ok', message: `Index provider available: ${config.index.provider}` }];
        } catch (error) {
          return [{ status: 'error', message: `Index provider unavailable: ${(error as Error).message}` }];
        }
      }
    },
    {
      id: 'memory-provider',
      run: async () => {
        try {
          const memory = createMemoryAdapter(config.memory.provider, config.memory.path);
          await memory.status();
          return [{ status: 'ok', message: `Memory provider available: ${config.memory.provider}` }];
        } catch (error) {
          return [{ status: 'warn', message: `Memory provider needs setup: ${(error as Error).message}` }];
        }
      }
    },
    {
      id: 'repos',
      run: async () => {
        const lines: CheckLine[] = [];
        for (const repo of config.repositories) {
          const exists = await pathExists(repo.path);
          if (!exists) {
            lines.push({ status: 'error', message: `${repo.name}: path missing ${repo.path}` });
            continue;
          }

          const git = await isGitRepo(repo.path);
          const commit = git ? await getCurrentCommit(repo.path) : undefined;
          lines.push(
            git
              ? { status: 'ok', message: `${repo.name}: ${commit?.slice(0, 7) ?? 'no commit'}` }
              : { status: 'warn', message: `${repo.name}: path exists, not a git repo` }
          );
        }
        return lines;
      }
    },
    {
      id: 'drift',
      run: async () => {
        const drift = await detectDrift(config);
        const lines: CheckLine[] = [];
        for (const key of drift.installedSkills) {
          const [agent] = key.split(':');
          lines.push(
            drift.staleSkills.includes(key)
              ? { status: 'warn', message: `${key} skill is outdated. Run: ctxhub skills install ${agent}` }
              : { status: 'ok', message: `${key} skill up to date` }
          );
        }
        for (const agent of drift.installedAgentConfigs) {
          lines.push(
            drift.staleAgentConfigs.includes(agent)
              ? { status: 'warn', message: `${agent} MCP config is outdated. Run: ctxhub agent ${agent} --no-launch` }
              : { status: 'ok', message: `${agent} MCP config up to date` }
          );
        }
        return lines;
      }
    }
  ];
}

export async function runDoctorChecks(
  checks: DoctorCheck[],
  onCheckDone?: (id: string, lines: CheckLine[]) => void
): Promise<CheckLine[]> {
  const all: CheckLine[] = [];
  for (const check of checks) {
    const lines = await check.run();
    all.push(...lines);
    onCheckDone?.(check.id, lines);
  }
  return all;
}

export function iconFor(status: CheckStatus): string {
  if (status === 'ok') return chalk.green('✓');
  if (status === 'warn') return chalk.yellow('!');
  return chalk.red('✗');
}

export function printCheckLine(line: CheckLine): void {
  console.log(`${iconFor(line.status)} ${line.message}`);
}
