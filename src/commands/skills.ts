import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { readText, writeText } from '../utils/fs.js';

export const SUPPORTED_SKILL_AGENTS = ['claude', 'codex', 'copilot', 'cursor'] as const;
export type SkillAgent = (typeof SUPPORTED_SKILL_AGENTS)[number];

// dist/commands/skills.js and src/commands/skills.ts are both two directories below the package root.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const SKILL_TEMPLATES: Record<SkillAgent, { source: string; target: (cwd: string) => string }> = {
  claude: {
    source: path.join(PACKAGE_ROOT, 'skills', 'claude', 'SKILL.md'),
    target: cwd => path.join(cwd, '.claude', 'skills', 'ctxhub', 'SKILL.md')
  },
  codex: {
    source: path.join(PACKAGE_ROOT, 'skills', 'codex', 'SKILL.md'),
    target: cwd => path.join(cwd, '.agents', 'skills', 'ctxhub', 'SKILL.md')
  },
  copilot: {
    source: path.join(PACKAGE_ROOT, 'skills', 'copilot', 'ctxhub.prompt.md'),
    target: cwd => path.join(cwd, '.github', 'prompts', 'ctxhub.prompt.md')
  },
  cursor: {
    source: path.join(PACKAGE_ROOT, 'skills', 'cursor', 'ctxhub.md'),
    target: cwd => path.join(cwd, '.cursor', 'commands', 'ctxhub.md')
  }
};

export async function skillsInstallCommand(agents: string[] = []) {
  const targets = agents.length ? agents : [...SUPPORTED_SKILL_AGENTS];

  for (const agent of targets) {
    if (!SKILL_TEMPLATES[agent as SkillAgent]) {
      throw new Error(`Unsupported agent: ${agent}. Supported: ${SUPPORTED_SKILL_AGENTS.join(', ')}`);
    }
  }

  const cwd = process.cwd();
  for (const agent of targets) {
    const { source, target } = SKILL_TEMPLATES[agent as SkillAgent];
    const destination = target(cwd);
    await writeText(destination, await readText(source));
    console.log(chalk.green(`Installed ctxhub skill for ${agent}: ${destination}`));
  }
}
