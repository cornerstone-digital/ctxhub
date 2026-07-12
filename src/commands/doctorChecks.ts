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
import { detectAvailableAgent, isAgentCliAvailable } from '../llm/runAgent.js';
import { isAuthConfigured, loadAuthConfig } from '../auth/config.js';
import { loadTokens, isTokenExpired } from '../auth/store.js';
import { loadGroupStore } from '../groups/store.js';
import { getPackageVersion, fetchLatestNpmVersion, compareSemver } from '../utils/version.js';

export type CheckStatus = 'ok' | 'warn' | 'error';
export type CheckLine = { status: CheckStatus; message: string };
export type DoctorCheck = { id: string; run: () => Promise<CheckLine[]> };

export const CHECK_LABELS: Record<string, string> = {
  version: 'ctxhub version',
  node: 'Node.js',
  git: 'Git',
  config: 'Config',
  schema: 'Config schema',
  privacy: 'Privacy settings',
  'index-directory': 'Index directory',
  'index-provider': 'Index provider',
  'memory-provider': 'Memory provider',
  repos: 'Repositories',
  drift: 'Installed skills, agent configs & personas',
  'llm-features': 'LLM-backed features',
  'enterprise-auth': 'Enterprise: Auth',
  'enterprise-session': 'Enterprise: Session',
  'enterprise-role-map': 'Enterprise: Role map',
  'enterprise-groups': 'Enterprise: Groups store',
  'enterprise-index': 'Enterprise: Indexed knowledge',
  'enterprise-licence': 'Enterprise: Licence'
};

export function buildEnterpriseChecks(config: CtxhubConfig, workspaceRoot = process.cwd()): DoctorCheck[] {
  return [
    {
      id: 'enterprise-auth',
      run: async () => {
        const configured = await isAuthConfigured();
        if (configured) return [{ status: 'ok', message: 'Auth: Entra ID configured' }];
        return [{ status: 'error', message: 'Auth: not configured (run: ctxhub auth configure)' }];
      }
    },
    {
      id: 'enterprise-session',
      run: async () => {
        const configured = await isAuthConfigured();
        if (!configured) return [];
        const tokens = await loadTokens();
        if (!tokens) return [{ status: 'warn', message: 'Session: expired or not logged in (run: ctxhub login)' }];
        const expired = isTokenExpired(tokens.ctxhubToken.expiresAt);
        if (expired) return [{ status: 'warn', message: 'Session: expired or not logged in (run: ctxhub login)' }];
        return [{ status: 'ok', message: `Session: active (${tokens.user.email})` }];
      }
    },
    {
      id: 'enterprise-role-map',
      run: async () => {
        const configured = await isAuthConfigured();
        if (!configured) return [];
        const authConfig = await loadAuthConfig();
        const roleMap = authConfig?.roleMap;
        const hasOwnerSubs = (roleMap?.ownerSubs?.length ?? 0) > 0;
        const hasGroupRoles = Object.keys(roleMap?.groupRoles ?? {}).length > 0;
        if (!hasOwnerSubs && !hasGroupRoles) {
          return [{ status: 'warn', message: 'Role map: empty — all authenticated users will get default role' }];
        }
        return [{ status: 'ok', message: 'Role map: configured' }];
      }
    },
    {
      id: 'enterprise-groups',
      run: async () => {
        try {
          await loadGroupStore();
          return [{ status: 'ok', message: 'Groups: store OK' }];
        } catch {
          return [{ status: 'error', message: 'Groups: store corrupted or unreadable' }];
        }
      }
    },
    {
      id: 'enterprise-index',
      run: async () => {
        try {
          const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
          const status = await index.status();
          if (status.documentCount === 0) {
            return [{ status: 'warn', message: 'Index: no indexed documents found (run: ctxhub index)' }];
          }
          return [{ status: 'ok', message: `Index: ${status.documentCount} documents across 1 workspace` }];
        } catch {
          return [{ status: 'warn', message: 'Index: no indexed documents found (run: ctxhub index)' }];
        }
      }
    },
    {
      id: 'enterprise-licence',
      run: async () => {
        try {
          const { loadLicence, validateLicence } = await import('../licence/licence.js');
          const licence = await loadLicence();
          if (!licence) {
            return [{
              status: 'ok',
              message: 'Licence: no licence file (not required for self-hosted; needed for air-gapped enterprise)'
            }];
          }
          const validation = validateLicence(licence);
          if (validation.status === 'valid') {
            return [{
              status: 'ok',
              message: `Licence: valid — ${licence.orgName} (expires ${new Date(licence.validUntil).toLocaleDateString()})`
            }];
          }
          if (validation.status === 'expired') {
            return [{
              status: 'warn',
              message: `Licence: expired — ${licence.orgName} (expired ${new Date(licence.validUntil).toLocaleDateString()})`
            }];
          }
          return [{
            status: 'error',
            message: `Licence: invalid — ${validation.reason ?? 'signature verification failed'}`
          }];
        } catch {
          return [{ status: 'warn', message: 'Licence: could not read licence file' }];
        }
      }
    }
  ];
}

// Order matches the original sequential doctorCommand implementation exactly, so the
// non-TTY (plain console.log) rendering path stays byte-for-byte identical.
export function buildDoctorChecks(config: CtxhubConfig, configPath: string, workspaceRoot = process.cwd(), opts: { enterprise?: boolean } = {}): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    {
      id: 'version',
      run: async () => {
        const current = getPackageVersion();
        const latest = await fetchLatestNpmVersion(3_000);
        if (!latest) {
          return [{ status: 'ok', message: `ctxhub v${current} (version check skipped — no network)` }];
        }
        if (compareSemver(current, latest) < 0) {
          return [{ status: 'warn', message: `ctxhub v${current} — update available: v${latest} (run: npm install -g ctxhub)` }];
        }
        return [{ status: 'ok', message: `ctxhub v${current} — up to date` }];
      }
    },
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
          await ensureDir(path.join(workspaceRoot, INDEX_DIR));
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
          const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
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
          const memory = createMemoryAdapter(config.memory.provider, config.memory.path, workspaceRoot);
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
          const repoPath = path.resolve(workspaceRoot, repo.path);
          const exists = await pathExists(repoPath);
          if (!exists) {
            lines.push({ status: 'error', message: `${repo.name}: path missing ${repo.path}` });
            continue;
          }

          const git = await isGitRepo(repoPath);
          const commit = git ? await getCurrentCommit(repoPath) : undefined;
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
        for (const key of drift.installedPersonas) {
          const [agent] = key.split(':');
          lines.push(
            drift.stalePersonas.includes(key)
              ? { status: 'warn', message: `${key} persona is outdated. Run: ctxhub personas sync ${agent}` }
              : { status: 'ok', message: `${key} persona up to date` }
          );
        }
        return lines;
      }
    },
    {
      id: 'llm-features',
      run: async () => {
        if (!config.llm.enabled) {
          return [
            {
              status: 'ok',
              message:
                'LLM-backed features disabled (opt-in) -- enable `llm.enabled` for AI-drafted PR descriptions, ' +
                'drift-repair suggestions, and more. See README.'
            }
          ];
        }

        if (config.llm.agent) {
          const available = await isAgentCliAvailable(config.llm.agent);
          return [
            available
              ? { status: 'ok', message: `LLM-backed features enabled, using configured agent: ${config.llm.agent}` }
              : { status: 'warn', message: `LLM-backed features enabled, but configured agent "${config.llm.agent}" was not found on PATH.` }
          ];
        }

        const detected = await detectAvailableAgent();
        return [
          detected
            ? { status: 'ok', message: `LLM-backed features enabled, auto-detected agent: ${detected}` }
            : { status: 'warn', message: 'LLM-backed features enabled, but no supported agent CLI was found on PATH.' }
        ];
      }
    }
  ];

  if (opts.enterprise) {
    checks.push(...buildEnterpriseChecks(config, workspaceRoot));
  }

  return checks;
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
