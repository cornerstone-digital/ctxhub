import { pathExists, readText } from './fs.js';
import { SKILL_TEMPLATES } from '../commands/skills.js';
import { SUPPORTED_AGENTS, expectedMcpEntry, readInstalledMcpEntry, type SupportedAgent } from '../commands/agent.js';
import { defaultConfig } from '../config/defaultConfig.js';
import type { CtxhubConfig } from '../config/types.js';

// Keyed "agent:id", e.g. "claude:ctxhub-search" -- one entry per installed skill file,
// since an agent can have more than one (an ambient skill plus an explicit on-demand one).
export type DriftReport = {
  installedSkills: string[];
  staleSkills: string[];
  installedAgentConfigs: SupportedAgent[];
  staleAgentConfigs: SupportedAgent[];
  configVersionMismatch: boolean;
};

// Compares what's installed in a workspace against what the currently-installed ctxhub
// version would produce. Agents/skills never installed here are omitted from both the
// installed* and stale* lists -- this reports drift, not incompleteness.
export async function detectDrift(config: CtxhubConfig, cwd = process.cwd()): Promise<DriftReport> {
  const installedSkills: string[] = [];
  const staleSkills: string[] = [];
  for (const { agent, id, source, target } of SKILL_TEMPLATES) {
    const destination = target(cwd);
    if (!(await pathExists(destination))) continue;

    const key = `${agent}:${id}`;
    installedSkills.push(key);
    const [installed, current] = await Promise.all([readText(destination), readText(source)]);
    if (installed !== current) staleSkills.push(key);
  }

  const installedAgentConfigs: SupportedAgent[] = [];
  const staleAgentConfigs: SupportedAgent[] = [];
  for (const agent of SUPPORTED_AGENTS) {
    const installed = await readInstalledMcpEntry(agent, cwd);
    if (installed === undefined) continue;

    installedAgentConfigs.push(agent);
    if (JSON.stringify(installed) !== JSON.stringify(expectedMcpEntry(agent))) staleAgentConfigs.push(agent);
  }

  return {
    installedSkills,
    staleSkills,
    installedAgentConfigs,
    staleAgentConfigs,
    configVersionMismatch: config.version !== defaultConfig.version
  };
}

export function driftCount(report: DriftReport): number {
  return report.staleSkills.length + report.staleAgentConfigs.length + (report.configVersionMismatch ? 1 : 0);
}
