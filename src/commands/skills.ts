import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm, symlink } from 'node:fs/promises';
import chalk from 'chalk';
import { ensureDir, pathExists, readText, writeText } from '../utils/fs.js';
import { loadWorkspaceConfig } from '../config/config.js';
import type { CtxhubConfig } from '../config/types.js';

export const SUPPORTED_SKILL_AGENTS = ['claude', 'codex', 'copilot', 'cursor'] as const;
export type SkillAgent = (typeof SUPPORTED_SKILL_AGENTS)[number];

// dist/commands/skills.js and src/commands/skills.ts are both two directories below the package root.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export type SkillTemplate = {
  agent: SkillAgent;
  // Unique per agent, e.g. "ctxhub" (ambient, auto-invoked guidance) or
  // "ctxhub-search" (explicit, argument-driven on-demand search).
  id: string;
  label?: string;
  source: string;
  target: (cwd: string) => string;
};

export const SKILL_TEMPLATES: SkillTemplate[] = [
  {
    agent: 'claude',
    id: 'ctxhub',
    source: path.join(PACKAGE_ROOT, 'skills', 'claude', 'ctxhub', 'SKILL.md'),
    target: cwd => path.join(cwd, '.claude', 'skills', 'ctxhub', 'SKILL.md')
  },
  {
    agent: 'claude',
    id: 'ctxhub-search',
    source: path.join(PACKAGE_ROOT, 'skills', 'claude', 'ctxhub-search', 'SKILL.md'),
    target: cwd => path.join(cwd, '.claude', 'skills', 'ctxhub-search', 'SKILL.md')
  },
  {
    agent: 'codex',
    id: 'ctxhub',
    source: path.join(PACKAGE_ROOT, 'skills', 'codex', 'ctxhub', 'SKILL.md'),
    target: cwd => path.join(cwd, '.agents', 'skills', 'ctxhub', 'SKILL.md')
  },
  {
    agent: 'codex',
    id: 'ctxhub-search',
    source: path.join(PACKAGE_ROOT, 'skills', 'codex', 'ctxhub-search', 'SKILL.md'),
    target: cwd => path.join(cwd, '.agents', 'skills', 'ctxhub-search', 'SKILL.md')
  },
  {
    agent: 'copilot',
    id: 'ctxhub',
    source: path.join(PACKAGE_ROOT, 'skills', 'copilot', 'ctxhub', 'SKILL.md'),
    target: cwd => path.join(cwd, '.github', 'skills', 'ctxhub', 'SKILL.md')
  },
  {
    agent: 'copilot',
    id: 'ctxhub-search',
    source: path.join(PACKAGE_ROOT, 'skills', 'copilot', 'ctxhub-search', 'SKILL.md'),
    target: cwd => path.join(cwd, '.github', 'skills', 'ctxhub-search', 'SKILL.md')
  },
  {
    agent: 'cursor',
    id: 'ctxhub',
    source: path.join(PACKAGE_ROOT, 'skills', 'cursor', 'ctxhub', 'SKILL.md'),
    target: cwd => path.join(cwd, '.cursor', 'skills', 'ctxhub', 'SKILL.md')
  },
  {
    agent: 'cursor',
    id: 'ctxhub-search',
    source: path.join(PACKAGE_ROOT, 'skills', 'cursor', 'ctxhub-search', 'SKILL.md'),
    target: cwd => path.join(cwd, '.cursor', 'skills', 'ctxhub-search', 'SKILL.md')
  }
];

const LEGACY_SKILL_TARGETS: Array<{ agent: SkillAgent; target: (cwd: string) => string }> = [
  { agent: 'copilot', target: cwd => path.join(cwd, '.github', 'prompts', 'ctxhub.prompt.md') },
  { agent: 'copilot', target: cwd => path.join(cwd, '.github', 'prompts', 'ctxhub-search.prompt.md') },
  { agent: 'cursor', target: cwd => path.join(cwd, '.cursor', 'commands', 'ctxhub.md') },
  { agent: 'cursor', target: cwd => path.join(cwd, '.cursor', 'commands', 'ctxhub-search.md') }
];

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

    for (const { target } of LEGACY_SKILL_TARGETS.filter(t => t.agent === agent)) {
      for (const root of [workspaceRoot, ...repoRoots]) {
        await rm(target(root), { force: true });
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
