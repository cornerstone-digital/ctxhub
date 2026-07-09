import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { readText, writeText } from '../utils/fs.js';

export const SUPPORTED_SKILL_AGENTS = ['claude', 'codex', 'copilot', 'cursor'] as const;
export type SkillAgent = (typeof SUPPORTED_SKILL_AGENTS)[number];

// dist/commands/skills.js and src/commands/skills.ts are both two directories below the package root.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export type SkillTemplate = {
  agent: SkillAgent;
  // Unique per agent, e.g. "ctxhub" (ambient, auto-invoked guidance) or
  // "ctxhub-search" (explicit, argument-driven on-demand search).
  id: string;
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
    source: path.join(PACKAGE_ROOT, 'skills', 'copilot', 'ctxhub.prompt.md'),
    target: cwd => path.join(cwd, '.github', 'prompts', 'ctxhub.prompt.md')
  },
  {
    agent: 'copilot',
    id: 'ctxhub-search',
    source: path.join(PACKAGE_ROOT, 'skills', 'copilot', 'ctxhub-search.prompt.md'),
    target: cwd => path.join(cwd, '.github', 'prompts', 'ctxhub-search.prompt.md')
  },
  {
    agent: 'cursor',
    id: 'ctxhub',
    source: path.join(PACKAGE_ROOT, 'skills', 'cursor', 'ctxhub.md'),
    target: cwd => path.join(cwd, '.cursor', 'commands', 'ctxhub.md')
  },
  {
    agent: 'cursor',
    id: 'ctxhub-search',
    source: path.join(PACKAGE_ROOT, 'skills', 'cursor', 'ctxhub-search.md'),
    target: cwd => path.join(cwd, '.cursor', 'commands', 'ctxhub-search.md')
  }
];

export async function skillsInstallCommand(agents: string[] = []) {
  const targets = agents.length ? agents : [...SUPPORTED_SKILL_AGENTS];

  for (const agent of targets) {
    if (!(SUPPORTED_SKILL_AGENTS as readonly string[]).includes(agent)) {
      throw new Error(`Unsupported agent: ${agent}. Supported: ${SUPPORTED_SKILL_AGENTS.join(', ')}`);
    }
  }

  const cwd = process.cwd();
  for (const agent of targets) {
    for (const { id, source, target } of SKILL_TEMPLATES.filter(t => t.agent === agent)) {
      const destination = target(cwd);
      await writeText(destination, await readText(source));
      console.log(chalk.green(`Installed ctxhub skill '${id}' for ${agent}: ${destination}`));
    }
  }
}
