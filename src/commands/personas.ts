import path from 'node:path';
import { rm, symlink } from 'node:fs/promises';
import chalk from 'chalk';
import { loadWorkspaceConfig } from '../config/config.js';
import type { CtxhubConfig } from '../config/types.js';
import { ensureDir, pathExists, writeText } from '../utils/fs.js';
import { agentsWithCapability, isCapableOf } from '../llm/harness.js';
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

// docs/personas.md Phase 3, scoped per the explicit decision there: only Claude Code gets the
// real native-subagent treatment (nativeSubagents: true, confirmed .claude/agents/*.md format).
// Codex/Copilot/Cursor get a plain project-instructions fallback -- not a guess dressed up as a
// native integration -- until someone confirms each harness's own current docs say otherwise (see
// src/llm/harness.ts's HarnessCapabilities comment).
export const SUPPORTED_PERSONA_SYNC_AGENTS = agentsWithCapability('skills');
export type PersonaSyncAgent = (typeof SUPPORTED_PERSONA_SYNC_AGENTS)[number];

const PERSONA_TARGET_ROOTS: Record<PersonaSyncAgent, (cwd: string) => string> = {
  claude: cwd => path.join(cwd, '.claude', 'agents'),
  codex: cwd => path.join(cwd, '.agents', 'personas'),
  copilot: cwd => path.join(cwd, '.github', 'personas'),
  cursor: cwd => path.join(cwd, '.cursor', 'personas')
};

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

      const content = isCapableOf('nativeSubagents')(agent) ? renderNativeSubagent(persona) : renderFallbackInstructions(name, persona);
      const fileName = `${name}.md`;
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

// Claude Code's real, documented subagent format: YAML frontmatter (name, description -- used by
// Claude's own automatic-delegation heuristic to decide when to reach for this subagent) plus the
// persona body as the subagent's system prompt.
function renderNativeSubagent(persona: Persona): string {
  const description = persona.description ?? `ctxhub persona: ${persona.name}`;
  return `---
name: ${persona.name}
description: ${description}
---

${persona.body.trim()}
`;
}

function renderFallbackInstructions(name: string, persona: Persona): string {
  return `<!-- Compiled by \`ctxhub personas sync\` from agents/personas/${name}.md -- edit that file, not this one. -->

${persona.body.trim()}
`;
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
