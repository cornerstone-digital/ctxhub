import path from 'node:path';
import chalk from 'chalk';
import { writeText } from '../utils/fs.js';

export const SKILL_NAME = 'ssd';
export const SUPPORTED_SKILL_AGENTS = ['claude', 'codex', 'copilot', 'cursor'] as const;
export type SkillAgent = (typeof SUPPORTED_SKILL_AGENTS)[number];

const SKILL_DESCRIPTION =
  "Use ssd to search this workspace's indexed docs and source before answering questions about " +
  'existing code, decisions, or documentation across the configured repos.';

const SKILL_BODY = `This workspace uses \`ssd\` (see \`ssd.yaml\` / \`.ssd/config.yaml\`) to index documentation and source across its configured repos.

## When to use this

- Before answering questions about how existing code works, where something is implemented, or why a decision was made — check the index first rather than guessing.
- After the user mentions pulling new changes or switching branches, treat the index as possibly stale.

## How to use it

- If the \`ssd\` MCP server is connected, prefer its tools: \`search\`, \`memory_status\`, \`repo_list\`.
- Otherwise, run the CLI directly: \`ssd search "<query>"\`, \`ssd memory status\`, \`ssd repo list\`.
- Run \`ssd sync\` (or ask the user to) if search results look stale — it pulls configured repos and re-indexes changed files.
- Don't run \`ssd index\`, \`ssd sync\`, or \`ssd memory clear\` without the user's intent; these mutate the workspace's index/repos.
`;

function skillMdFrontmatter(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n`;
}

async function installClaude(cwd: string): Promise<string> {
  const target = path.join(cwd, '.claude', 'skills', SKILL_NAME, 'SKILL.md');
  await writeText(target, skillMdFrontmatter(SKILL_NAME, SKILL_DESCRIPTION) + SKILL_BODY);
  return target;
}

async function installCodex(cwd: string): Promise<string> {
  const target = path.join(cwd, '.agents', 'skills', SKILL_NAME, 'SKILL.md');
  await writeText(target, skillMdFrontmatter(SKILL_NAME, SKILL_DESCRIPTION) + SKILL_BODY);
  return target;
}

async function installCopilot(cwd: string): Promise<string> {
  const target = path.join(cwd, '.github', 'prompts', `${SKILL_NAME}.prompt.md`);
  const frontmatter = `---\ndescription: ${SKILL_DESCRIPTION}\n---\n\n`;
  await writeText(target, frontmatter + SKILL_BODY);
  return target;
}

async function installCursor(cwd: string): Promise<string> {
  const target = path.join(cwd, '.cursor', 'commands', `${SKILL_NAME}.md`);
  await writeText(target, `# Using ssd\n\n${SKILL_BODY}`);
  return target;
}

const INSTALLERS: Record<SkillAgent, (cwd: string) => Promise<string>> = {
  claude: installClaude,
  codex: installCodex,
  copilot: installCopilot,
  cursor: installCursor
};

export async function skillsInstallCommand(agents: string[] = []) {
  const targets = agents.length ? agents : [...SUPPORTED_SKILL_AGENTS];

  for (const agent of targets) {
    if (!INSTALLERS[agent as SkillAgent]) {
      throw new Error(`Unsupported agent: ${agent}. Supported: ${SUPPORTED_SKILL_AGENTS.join(', ')}`);
    }
  }

  const cwd = process.cwd();
  for (const agent of targets) {
    const target = await INSTALLERS[agent as SkillAgent](cwd);
    console.log(chalk.green(`Installed ssd skill for ${agent}: ${target}`));
  }
}
