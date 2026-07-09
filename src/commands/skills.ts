import path from 'node:path';
import { fileURLToPath } from 'node:url';
import chalk from 'chalk';
import { readText, writeText } from '../utils/fs.js';

export const SUPPORTED_SKILL_AGENTS = ['claude', 'codex', 'copilot', 'cursor'] as const;
export type SkillAgent = (typeof SUPPORTED_SKILL_AGENTS)[number];

// dist/commands/skills.js and src/commands/skills.ts are both two directories below the package root.
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TEMPLATES: Record<SkillAgent, { source: string; target: (cwd: string) => string }> = {
  claude: {
    source: path.join(PACKAGE_ROOT, 'skills', 'claude', 'SKILL.md'),
    target: cwd => path.join(cwd, '.claude', 'skills', 'ssd', 'SKILL.md')
  },
  codex: {
    source: path.join(PACKAGE_ROOT, 'skills', 'codex', 'SKILL.md'),
    target: cwd => path.join(cwd, '.agents', 'skills', 'ssd', 'SKILL.md')
  },
  copilot: {
    source: path.join(PACKAGE_ROOT, 'skills', 'copilot', 'ssd.prompt.md'),
    target: cwd => path.join(cwd, '.github', 'prompts', 'ssd.prompt.md')
  },
  cursor: {
    source: path.join(PACKAGE_ROOT, 'skills', 'cursor', 'ssd.md'),
    target: cwd => path.join(cwd, '.cursor', 'commands', 'ssd.md')
  }
};

export async function skillsInstallCommand(agents: string[] = []) {
  const targets = agents.length ? agents : [...SUPPORTED_SKILL_AGENTS];

  for (const agent of targets) {
    if (!TEMPLATES[agent as SkillAgent]) {
      throw new Error(`Unsupported agent: ${agent}. Supported: ${SUPPORTED_SKILL_AGENTS.join(', ')}`);
    }
  }

  const cwd = process.cwd();
  for (const agent of targets) {
    const { source, target } = TEMPLATES[agent as SkillAgent];
    const destination = target(cwd);
    await writeText(destination, await readText(source));
    console.log(chalk.green(`Installed ssd skill for ${agent}: ${destination}`));
  }
}
