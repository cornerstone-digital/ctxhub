import path from 'node:path';
import yaml from 'js-yaml';
import { pathExists, readText, writeText } from '../utils/fs.js';

// docs/personas.md Phase 1: personas are a new, top-level git-tracked directory (`agents/`), not
// nested under `.ctxhub/` -- that directory is entirely gitignored (index/cache/memory), so
// anything meant to be reviewed and PR'd (like a team's personas/policies) can't live there
// without either vanishing from git history or fighting the directory's whole purpose.
export const AGENTS_DIR = 'agents';
const MANIFEST_PATH = path.join(AGENTS_DIR, 'manifest.yaml');

export type Persona = { name: string; description?: string; body: string };

export type PersonaManifest = {
  version: 1;
  personas: Record<string, { source: string }>;
  policies: string[];
};

const EMPTY_MANIFEST: PersonaManifest = { version: 1, personas: {}, policies: [] };

const DEFAULT_PERSONA_NAME = 'architect';

const DEFAULT_MANIFEST: PersonaManifest = {
  version: 1,
  personas: { [DEFAULT_PERSONA_NAME]: { source: `personas/${DEFAULT_PERSONA_NAME}.md` } },
  policies: ['policies/evidence.md']
};

const DEFAULT_PERSONA_CONTENT = `---
description: Protects long-term maintainability and architectural consistency.
---

# Architect

## Identity

You are the Software Architect. You care about the shape of the system holding up over time, not
just the correctness of the change in front of you.

## Responsibilities

- Protect long-term maintainability.
- Reduce complexity; prefer the simpler design that still solves the real problem.
- Encourage consistency with how the rest of the codebase already does things.

## Decision Framework

- Simple > Clever
- Explicit > Magic
- Composition > Inheritance
- Maintainability > Premature optimization

## Communication Style

Direct and concrete. Reference the actual files/patterns involved, not abstract principles alone.

## Quality Gates

- Does this fit the existing architecture, or fight it?
- Could this be simpler without losing what it needs to do?
- Would a teammate unfamiliar with this change understand it in six months?

Edit this file to match your own team's engineering principles -- this is a starting point, not a
fixed template. See docs/personas.md for how personas are used.
`;

const DEFAULT_POLICY_CONTENT = `# Evidence discipline

Every claim must be grounded in the evidence provided for this specific call -- never invent a
citation, file path, repository, component, or fact that is not explicitly present in that
evidence. If the evidence doesn't support an answer, say so plainly instead of guessing.

This policy always applies, regardless of which persona (if any) is active -- a persona's own
communication style or priorities never override it.
`;

// Deliberately NOT auto-seeded on first read, unlike review.ts's loadReviewerProfiles -- that
// precedent is fine for an explicit, feature-specific command like `ctxhub review`, but
// `loadPolicyText`/`loadPersona` get called from everyday commands (explain, ask, handoff) that
// would otherwise silently create a new `agents/` directory just from normal use. Only the
// explicit `ctxhub agents init` command (initAgentsDirectory below) writes anything.
export async function loadPersonaManifest(workspaceRoot: string): Promise<PersonaManifest> {
  const manifestPath = path.join(workspaceRoot, MANIFEST_PATH);
  if (!(await pathExists(manifestPath))) return EMPTY_MANIFEST;
  const parsed = yaml.load(await readText(manifestPath));
  return { ...EMPTY_MANIFEST, ...(parsed as Partial<PersonaManifest> | undefined) };
}

export async function loadPersona(workspaceRoot: string, name: string): Promise<Persona | undefined> {
  const manifest = await loadPersonaManifest(workspaceRoot);
  const entry = manifest.personas[name];
  if (!entry) return undefined;

  const sourcePath = path.join(workspaceRoot, AGENTS_DIR, entry.source);
  if (!(await pathExists(sourcePath))) return undefined;

  const { data, body } = parseFrontmatter(await readText(sourcePath));
  const description = typeof data.description === 'string' ? data.description : undefined;
  return { name, description, body };
}

// Returns '' (never throws, never partially-fails) when no policies are configured -- callers
// treat an empty policy block as "add nothing to the prompt," which is what keeps every existing
// command's output byte-identical until a team actually opts in by running `ctxhub agents init`.
export async function loadPolicyText(workspaceRoot: string): Promise<string> {
  const manifest = await loadPersonaManifest(workspaceRoot);
  if (!manifest.policies.length) return '';

  const blocks: string[] = [];
  for (const relativePath of manifest.policies) {
    const policyPath = path.join(workspaceRoot, AGENTS_DIR, relativePath);
    if (await pathExists(policyPath)) blocks.push((await readText(policyPath)).trim());
  }
  return blocks.join('\n\n');
}

export async function initAgentsDirectory(workspaceRoot: string): Promise<{ created: string[] }> {
  const created: string[] = [];

  const manifestPath = path.join(workspaceRoot, MANIFEST_PATH);
  if (!(await pathExists(manifestPath))) {
    await writeText(manifestPath, yaml.dump(DEFAULT_MANIFEST, { lineWidth: 120 }));
    created.push(path.relative(workspaceRoot, manifestPath));
  }

  const personaPath = path.join(workspaceRoot, AGENTS_DIR, 'personas', `${DEFAULT_PERSONA_NAME}.md`);
  if (!(await pathExists(personaPath))) {
    await writeText(personaPath, DEFAULT_PERSONA_CONTENT);
    created.push(path.relative(workspaceRoot, personaPath));
  }

  const policyPath = path.join(workspaceRoot, AGENTS_DIR, 'policies', 'evidence.md');
  if (!(await pathExists(policyPath))) {
    await writeText(policyPath, DEFAULT_POLICY_CONTENT);
    created.push(path.relative(workspaceRoot, policyPath));
  }

  return { created };
}

// docs/personas.md Phase 2's fixed assembly order: policy > persona > command instructions >
// evidence > query. This builds the first two as one prependable block; each command's own
// prompt builder still constructs its command-specific instructions/evidence/query exactly as it
// does today. Returns '' when both are empty, so prepending it is a byte-identical no-op for any
// command that hasn't opted into personas/policies.
export function buildPromptPreamble(policyText: string, persona?: Persona): string {
  const sections: string[] = [];
  if (policyText) {
    sections.push(`Policy (always applies; a persona's preferences never override it):\n${policyText}`);
  }
  if (persona) {
    const label = persona.description ? `${persona.name} -- ${persona.description}` : persona.name;
    sections.push(`Persona: ${label}\n${persona.body.trim()}`);
  }
  return sections.length ? `${sections.join('\n\n')}\n\n` : '';
}

function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { data: {}, body: content };
  const data = (yaml.load(match[1]) ?? {}) as Record<string, unknown>;
  return { data, body: content.slice(match[0].length) };
}
