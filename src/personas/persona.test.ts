import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { buildPromptPreamble, initAgentsDirectory, loadPersona, loadPersonaManifest, loadPolicyText } from './persona.js';
import { pathExists, readText } from '../utils/fs.js';

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ctxhub-personas-'));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadPersonaManifest returns an empty manifest (not an error) when agents/ does not exist', () => {
  return withTempDir(async dir => {
    const manifest = await loadPersonaManifest(dir);
    assert.deepEqual(manifest, { version: 1, personas: {}, policies: [] });
  });
});

test('loadPolicyText returns an empty string when agents/ does not exist -- the "no behavior change unless opted in" guarantee', () => {
  return withTempDir(async dir => {
    assert.equal(await loadPolicyText(dir), '');
  });
});

test('loadPersona returns undefined for an unknown persona name or when agents/ does not exist', () => {
  return withTempDir(async dir => {
    assert.equal(await loadPersona(dir, 'architect'), undefined);
  });
});

test('loadPersonaManifest/loadPolicyText/loadPersona never write anything to disk on their own (only initAgentsDirectory does)', () => {
  return withTempDir(async dir => {
    await loadPersonaManifest(dir);
    await loadPolicyText(dir);
    await loadPersona(dir, 'architect');
    assert.equal(await pathExists(path.join(dir, 'agents')), false, 'a plain read must never create the agents/ directory');
  });
});

test('initAgentsDirectory scaffolds a manifest, a starter persona, and a starter policy on first run', () => {
  return withTempDir(async dir => {
    const { created } = await initAgentsDirectory(dir);
    assert.equal(created.length, 3);

    const manifest = await loadPersonaManifest(dir);
    assert.deepEqual(manifest, { version: 1, personas: { architect: { source: 'personas/architect.md' } }, policies: ['policies/evidence.md'] });

    const persona = await loadPersona(dir, 'architect');
    assert.equal(persona?.name, 'architect');
    assert.equal(persona?.description, 'Protects long-term maintainability and architectural consistency.');
    assert.match(persona?.body ?? '', /# Architect/);
    assert.ok(!(persona?.body ?? '').includes('---'), 'frontmatter should be stripped from the body');

    const policyText = await loadPolicyText(dir);
    assert.match(policyText, /Evidence discipline/);
    assert.match(policyText, /never invent/);
  });
});

test('initAgentsDirectory is idempotent -- does not overwrite files a team has already edited', () => {
  return withTempDir(async dir => {
    await initAgentsDirectory(dir);
    const personaPath = path.join(dir, 'agents', 'personas', 'architect.md');
    await writeFile(personaPath, '# My Custom Architect\n\nEdited by the team.\n');

    const second = await initAgentsDirectory(dir);
    assert.deepEqual(second.created, [], 'nothing new should be created the second time');

    const content = await readText(personaPath);
    assert.match(content, /My Custom Architect/);
  });
});

test('loadPersona parses frontmatter description and strips it from body; falls back to no description when absent', () => {
  return withTempDir(async dir => {
    await mkdir(path.join(dir, 'agents', 'personas'), { recursive: true });
    await writeFile(
      path.join(dir, 'agents', 'manifest.yaml'),
      'version: 1\npersonas:\n  reviewer:\n    source: personas/reviewer.md\npolicies: []\n'
    );
    await writeFile(path.join(dir, 'agents', 'personas', 'reviewer.md'), '# Reviewer\n\nNo frontmatter here.\n');

    const persona = await loadPersona(dir, 'reviewer');
    assert.equal(persona?.description, undefined);
    assert.match(persona?.body ?? '', /# Reviewer/);
  });
});

test('buildPromptPreamble returns an empty string when there is no policy and no persona -- a byte-identical no-op to prepend', () => {
  assert.equal(buildPromptPreamble(''), '');
  assert.equal(buildPromptPreamble('', undefined), '');
});

test('buildPromptPreamble includes only the policy section when no persona is given', () => {
  const preamble = buildPromptPreamble('Never invent evidence.');
  assert.match(preamble, /^Policy \(always applies/);
  assert.match(preamble, /Never invent evidence\./);
  assert.ok(!preamble.includes('Persona:'));
  assert.ok(preamble.endsWith('\n\n'), 'should end with a blank-line separator before the rest of the prompt');
});

test('buildPromptPreamble includes only the persona section when no policy is configured', () => {
  const preamble = buildPromptPreamble('', { name: 'architect', description: 'Cares about maintainability.', body: '# Architect\n\nBe careful.' });
  assert.ok(!preamble.includes('Policy'));
  assert.match(preamble, /^Persona: architect -- Cares about maintainability\./);
  assert.match(preamble, /Be careful\./);
});

test('buildPromptPreamble includes both sections, policy first, when both are present', () => {
  const preamble = buildPromptPreamble('Evidence rule.', { name: 'architect', body: 'Architect body.' });
  const policyIndex = preamble.indexOf('Policy');
  const personaIndex = preamble.indexOf('Persona:');
  assert.ok(policyIndex >= 0 && personaIndex > policyIndex, 'policy must appear before persona');
});

test('buildPromptPreamble falls back to the bare persona name when it has no description', () => {
  const preamble = buildPromptPreamble('', { name: 'reviewer', body: 'Reviewer body.' });
  assert.match(preamble, /^Persona: reviewer\n/);
});

test('loadPolicyText concatenates multiple configured policy files and skips a missing one gracefully', () => {
  return withTempDir(async dir => {
    await mkdir(path.join(dir, 'agents', 'policies'), { recursive: true });
    await writeFile(
      path.join(dir, 'agents', 'manifest.yaml'),
      'version: 1\npersonas: {}\npolicies:\n  - policies/evidence.md\n  - policies/safety.md\n  - policies/missing.md\n'
    );
    await writeFile(path.join(dir, 'agents', 'policies', 'evidence.md'), 'Evidence rule text.');
    await writeFile(path.join(dir, 'agents', 'policies', 'safety.md'), 'Safety rule text.');

    const policyText = await loadPolicyText(dir);
    assert.match(policyText, /Evidence rule text\./);
    assert.match(policyText, /Safety rule text\./);
  });
});
