import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm, symlink } from 'node:fs/promises';
import chalk from 'chalk';
import { ensureDir, pathExists, readText, writeText } from '../utils/fs.js';
import { loadWorkspaceConfig } from '../config/config.js';
import type { CtxhubConfig } from '../config/types.js';
import { agentsWithCapability } from '../llm/harness.js';

export const SUPPORTED_SKILL_AGENTS = agentsWithCapability('skills');
export type SkillAgent = (typeof SUPPORTED_SKILL_AGENTS)[number];
const SUPPORTED_SKILL_IDS = ['ctxhub', 'ctxhub-search', 'ctxhub-context', 'ctxhub-note', 'ctxhub-diagram'] as const;
type SkillId = (typeof SUPPORTED_SKILL_IDS)[number];

// dist/commands/skills.js and src/commands/skills.ts are both two directories below the package root.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export type SkillTemplate = {
  agent: SkillAgent;
  id: SkillId;
  label?: string;
  source: string;
  target: (cwd: string) => string;
};

const SKILL_TARGET_ROOTS: Record<SkillAgent, (cwd: string) => string> = {
  claude: cwd => path.join(cwd, '.claude', 'skills'),
  codex: cwd => path.join(cwd, '.agents', 'skills'),
  copilot: cwd => path.join(cwd, '.github', 'skills'),
  cursor: cwd => path.join(cwd, '.cursor', 'skills')
};

export const SKILL_TEMPLATES: SkillTemplate[] = SUPPORTED_SKILL_AGENTS.flatMap(agent =>
  SUPPORTED_SKILL_IDS.map(id => ({
    agent,
    id,
    source: path.join(PACKAGE_ROOT, 'skills', agent, id, 'SKILL.md'),
    target: cwd => path.join(SKILL_TARGET_ROOTS[agent](cwd), id, 'SKILL.md')
  }))
);

export async function skillsInstallCommand(agents: string[] = []) {
  const targets = agents.length ? agents : [...SUPPORTED_SKILL_AGENTS];

  for (const agent of targets) {
    if (!(SUPPORTED_SKILL_AGENTS as readonly string[]).includes(agent)) {
      throw new Error(`Unsupported agent: ${agent}. Supported: ${SUPPORTED_SKILL_AGENTS.join(', ')}`);
    }
  }

  const workspace = await loadWorkspaceConfig()
    .then(({ config, workspaceRoot }) => ({ config, workspaceRoot }))
    .catch(() => ({ config: undefined, workspaceRoot: process.cwd() }));
  const { config, workspaceRoot } = workspace;
  const repoRoots = await configuredRepoRoots(config, workspaceRoot);

  for (const agent of targets) {
    for (const { id, label, source, target } of SKILL_TEMPLATES.filter(t => t.agent === agent)) {
      const destination = target(workspaceRoot);
      const content = await readText(source);
      await writeText(destination, content);
      console.log(chalk.green(`Installed ctxhub skill '${label ?? id}' for ${agent}: ${destination}`));

      for (const repoRoot of repoRoots) {
        const linkedDestination = target(repoRoot);
        if (path.resolve(linkedDestination) === path.resolve(destination)) continue;
        await linkOrCopySkill(destination, linkedDestination, content);
        console.log(chalk.green(`Linked ctxhub skill '${label ?? id}' for ${agent}: ${linkedDestination}`));
      }
    }
  }
}

async function configuredRepoRoots(config: CtxhubConfig | undefined, workspaceRoot: string): Promise<string[]> {
  if (!config) return [];

  const roots: string[] = [];
  for (const repo of config.repositories) {
    const repoRoot = path.resolve(workspaceRoot, repo.path);
    if (repoRoot === workspaceRoot || !(await pathExists(repoRoot))) continue;
    roots.push(repoRoot);
  }
  return roots;
}

async function linkOrCopySkill(source: string, destination: string, fallbackContent: string): Promise<void> {
  await ensureDir(path.dirname(destination));
  await rm(destination, { force: true });

  try {
    const relativeSource = path.relative(path.dirname(destination), source);
    await symlink(relativeSource || source, destination);
  } catch {
    await writeText(destination, fallbackContent);
  }
}
