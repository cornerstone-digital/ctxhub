import path from 'node:path';
import { rm, symlink } from 'node:fs/promises';
import chalk from 'chalk';
import { stringify } from 'smol-toml';
import { loadWorkspaceConfig } from '../config/config.js';
import type { CtxhubConfig } from '../config/types.js';
import { ensureDir, pathExists, writeText } from '../utils/fs.js';
import { agentsWithCapability } from '../llm/harness.js';
import { initAgentsDirectory, loadPersona, loadPersonaManifest, type Persona } from '../personas/persona.js';

export async function personasInitCommand() {
  const { workspaceRoot } = await loadWorkspaceConfig();
  const { created } = await initAgentsDirectory(workspaceRoot);

  if (!created.length) {
    console.log(chalk.yellow('agents/ already exists -- nothing to scaffold.'));
    return;
  }

  console.log(chalk.green('Scaffolded:'));
  for (const file of created) console.log(`  ${file}`);
  console.log(chalk.gray('Edit these to match your team, then use --as <persona> on explain/ask/handoff/review.'));
  console.log(chalk.gray('See docs/personas.md for how this works.'));
}

// docs/personas.md Phase 3: all four harnesses have real, documented native subagent support,
// each with a genuinely different file format/location -- verified against each harness's own
// official docs (see the per-compiler comments below for exact sources).
export const SUPPORTED_PERSONA_SYNC_AGENTS = agentsWithCapability('nativeSubagents');
export type PersonaSyncAgent = (typeof SUPPORTED_PERSONA_SYNC_AGENTS)[number];

export type CompiledPersona = { fileName: string; content: string };

// Exported for src/utils/drift.ts: doctor's drift check needs to recompute each harness's
// expected file location/content to compare against what's actually installed.
export const PERSONA_TARGET_ROOTS: Record<PersonaSyncAgent, (cwd: string) => string> = {
  claude: cwd => path.join(cwd, '.claude', 'agents'),
  codex: cwd => path.join(cwd, '.codex', 'agents'),
  copilot: cwd => path.join(cwd, '.github', 'agents'),
  cursor: cwd => path.join(cwd, '.cursor', 'agents')
};

const PERSONA_COMPILERS: Record<PersonaSyncAgent, (persona: Persona) => CompiledPersona> = {
  claude: renderClaudeSubagent,
  codex: renderCodexSubagent,
  copilot: renderCopilotSubagent,
  cursor: renderCursorSubagent
};

export function compilePersonaFile(agent: PersonaSyncAgent, persona: Persona): CompiledPersona {
  return PERSONA_COMPILERS[agent](persona);
}

export async function personasSyncCommand(agents: string[] = []) {
  const targets = agents.length ? agents : [...SUPPORTED_PERSONA_SYNC_AGENTS];
  for (const agent of targets) {
    if (!(SUPPORTED_PERSONA_SYNC_AGENTS as readonly string[]).includes(agent)) {
      throw new Error(`Unsupported agent: ${agent}. Supported: ${SUPPORTED_PERSONA_SYNC_AGENTS.join(', ')}`);
    }
  }

  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const manifest = await loadPersonaManifest(workspaceRoot);
  const names = Object.keys(manifest.personas);

  if (!names.length) {
    console.log(chalk.yellow('No personas configured. Run: ctxhub personas init'));
    return;
  }

  const repoRoots = await configuredRepoRoots(config, workspaceRoot);

  for (const agent of targets as PersonaSyncAgent[]) {
    for (const name of names) {
      const persona = await loadPersona(workspaceRoot, name);
      if (!persona) continue;

      const { fileName, content } = PERSONA_COMPILERS[agent](persona);
      const destination = path.join(PERSONA_TARGET_ROOTS[agent](workspaceRoot), fileName);
      await writeText(destination, content);
      console.log(chalk.green(`Compiled persona '${name}' for ${agent}: ${path.relative(workspaceRoot, destination)}`));

      for (const repoRoot of repoRoots) {
        const linkedDestination = path.join(PERSONA_TARGET_ROOTS[agent](repoRoot), fileName);
        if (path.resolve(linkedDestination) === path.resolve(destination)) continue;
        await linkOrCopyPersona(destination, linkedDestination, content);
        console.log(chalk.green(`Linked persona '${name}' for ${agent}: ${path.relative(workspaceRoot, linkedDestination)}`));
      }
    }
  }
}

// Claude Code: .claude/agents/<name>.md -- YAML frontmatter (name, description; optionally tools,
// model, which ctxhub doesn't set, leaving them at their inherit-all/default-model behavior) plus
// the persona body as the subagent's system prompt. Verified live against the real `claude` CLI
// (`claude --agent <name> -p ...` responded in the persona's own voice).
function renderClaudeSubagent(persona: Persona): CompiledPersona {
  return {
    fileName: `${persona.name}.md`,
    content: `---
name: ${persona.name}
description: ${personaDescription(persona)}
---

${persona.body.trim()}
`
  };
}

// Codex CLI: .codex/agents/<name>.toml -- TOML, required fields name/description/
// developer_instructions (https://developers.openai.com/codex/subagents). Distinct from the other
// three: TOML, not Markdown, and the instructions live in a named field, not the file body.
function renderCodexSubagent(persona: Persona): CompiledPersona {
  return {
    fileName: `${persona.name}.toml`,
    content: stringify({
      name: persona.name,
      description: personaDescription(persona),
      developer_instructions: persona.body.trim()
    })
  };
}

// GitHub Copilot CLI: .github/agents/<name>.agent.md -- YAML frontmatter where `description` is
// the only strictly required field (name/tools/model are optional and inherit sensible defaults)
// (https://docs.github.com/en/copilot/reference/custom-agents-configuration). Note the distinct
// `.agent.md` filename, not plain `.md`.
function renderCopilotSubagent(persona: Persona): CompiledPersona {
  return {
    fileName: `${persona.name}.agent.md`,
    content: `---
name: ${persona.name}
description: ${personaDescription(persona)}
---

${persona.body.trim()}
`
  };
}

// Cursor: .cursor/agents/<name>.md -- YAML frontmatter (name, description; optional model,
// defaulting to "inherit") plus the persona body as the prompt (https://cursor.com/docs/subagents).
function renderCursorSubagent(persona: Persona): CompiledPersona {
  return {
    fileName: `${persona.name}.md`,
    content: `---
name: ${persona.name}
description: ${personaDescription(persona)}
---

${persona.body.trim()}
`
  };
}

function personaDescription(persona: Persona): string {
  return persona.description ?? `ctxhub persona: ${persona.name}`;
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

async function linkOrCopyPersona(source: string, destination: string, fallbackContent: string): Promise<void> {
  await ensureDir(path.dirname(destination));
  await rm(destination, { force: true });

  try {
    const relativeSource = path.relative(path.dirname(destination), source);
    await symlink(relativeSource || source, destination);
  } catch {
    await writeText(destination, fallbackContent);
  }
}
