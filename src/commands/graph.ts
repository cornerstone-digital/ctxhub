import path from 'node:path';
import { loadWorkspaceConfig } from '../config/config.js';
import type { RepoConfig } from '../config/types.js';
import { createIndexProvider } from '../indexing/providers.js';
import { pathExists, readText } from '../utils/fs.js';
import chalk from 'chalk';
import { shouldUseInteractive } from '../utils/interactive.js';

export type GraphPackage = {
  repo: string;
  package?: string;
  dependencies: string[];
};

export type DriftFinding = {
  severity: 'warning' | 'error';
  type: 'unknown-component' | 'unknown-relationship-endpoint' | 'unrepresented-repo';
  message: string;
  repo?: string;
  component?: string;
  relationship?: string;
};

export async function graphCommand(opts: { json?: boolean; drift?: boolean; failOnDrift?: boolean; plain?: boolean; interactive?: boolean } = {}) {
  const { config, workspaceRoot } = await loadWorkspaceConfig();
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const diagrams = (await index.search('architecture diagram mermaid', 100)).filter(result => result.kind === 'architecture-diagram');
  const packages: GraphPackage[] = [];

  for (const repo of config.repositories) {
    const packagePath = path.resolve(workspaceRoot, repo.path, 'package.json');
    if (await pathExists(packagePath)) {
      const parsed = JSON.parse(await readText(packagePath)) as { name?: string; dependencies?: Record<string, string> };
      packages.push({ repo: repo.name, package: parsed.name, dependencies: Object.keys(parsed.dependencies ?? {}) });
    }
  }

  const graph = {
    workspace: config.workspace.name,
    generatedAt: new Date().toISOString(),
    components: [...new Set(diagrams.flatMap(result => result.components ?? []))].sort(),
    relationships: [...new Set(diagrams.flatMap(result => result.relationships ?? []))].sort(),
    diagrams: diagrams.map(result => ({ repo: result.repo, path: result.filePath, type: result.diagramType })),
    packages
  };
  const drift = opts.drift ? analyzeArchitectureDrift({
    repos: config.repositories,
    components: graph.components,
    relationships: graph.relationships,
    diagrams: graph.diagrams,
    packages
  }) : undefined;
  const payload = drift ? { ...graph, drift } : graph;

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    if (opts.failOnDrift && drift?.length) process.exitCode = 1;
    return;
  }

  if (shouldUseInteractive(opts)) {
    printGraphSummary(graph, drift);
  }

  console.log(`# ${graph.workspace}`);
  console.log('\n## Components');
  for (const component of graph.components) console.log(`- ${component}`);
  console.log('\n## Relationships');
  for (const relationship of graph.relationships) console.log(`- ${relationship}`);
  console.log('\n## Packages');
  for (const pkg of graph.packages) console.log(`- ${pkg.repo}: ${pkg.package ?? '(unnamed)'}`);

  if (drift) {
    console.log('\n## Architecture Drift');
    if (!drift.length) {
      console.log('- none');
    } else {
      for (const severity of ['error', 'warning'] as const) {
        const findings = drift.filter(finding => finding.severity === severity);
        if (!findings.length) continue;
        console.log(`\n### ${severity}`);
        for (const finding of findings) console.log(`- ${finding.message}`);
      }
    }
    if (opts.failOnDrift && drift.length) process.exitCode = 1;
  }
}

function printGraphSummary(
  graph: {
    components: string[];
    relationships: string[];
    diagrams: Array<{ repo: string; path: string; type?: string }>;
    packages: GraphPackage[];
  },
  drift?: DriftFinding[]
): void {
  console.log(chalk.bold('ctxhub graph'));
  console.log(chalk.gray(`${graph.components.length} components · ${graph.relationships.length} relationships · ${graph.diagrams.length} diagrams · ${graph.packages.length} packages`));
  if (!graph.diagrams.length) {
    console.log(chalk.yellow('No indexed architecture diagrams yet. Run ctxhub diagram add <repo> "<title>", edit it, then ctxhub index.'));
  }
  if (drift) {
    const warnings = drift.filter(finding => finding.severity === 'warning').length;
    const errors = drift.filter(finding => finding.severity === 'error').length;
    console.log(chalk.gray(`Drift: ${errors} errors · ${warnings} warnings`));
  }
}

export function analyzeArchitectureDrift(input: {
  repos: RepoConfig[];
  components: string[];
  relationships: string[];
  diagrams: Array<{ repo: string; path: string; type?: string }>;
  packages: GraphPackage[];
}): DriftFinding[] {
  const findings: DriftFinding[] = [];
  const knownAliases = new Map<string, string>();

  for (const repo of input.repos) addAliases(knownAliases, repo.name, repo.name);
  for (const pkg of input.packages) {
    addAliases(knownAliases, pkg.repo, pkg.repo);
    if (pkg.package) addAliases(knownAliases, pkg.package, pkg.repo);
  }

  const representedAliases = new Set(input.components.map(normalizeComponent));

  for (const component of input.components) {
    if (!knownAliases.has(normalizeComponent(component))) {
      findings.push({
        severity: 'warning',
        type: 'unknown-component',
        component,
        message: `Unknown architecture component "${component}" does not match a configured repo or package name.`
      });
    }
  }

  for (const relationship of input.relationships) {
    const endpoints = relationshipEndpoints(relationship);
    for (const endpoint of endpoints) {
      if (!knownAliases.has(normalizeComponent(endpoint))) {
        findings.push({
          severity: 'warning',
          type: 'unknown-relationship-endpoint',
          component: endpoint,
          relationship,
          message: `Relationship endpoint "${endpoint}" is unknown in: ${relationship}`
        });
      }
    }
  }

  for (const repo of input.repos) {
    const aliases = componentAliases(repo.name);
    const pkg = input.packages.find(item => item.repo === repo.name);
    if (pkg?.package) aliases.push(...componentAliases(pkg.package));
    const represented = aliases.some(alias => representedAliases.has(alias));
    const hasOwnDiagram = input.diagrams.some(diagram => diagram.repo === repo.name);
    if (!represented && !hasOwnDiagram) {
      findings.push({
        severity: 'warning',
        type: 'unrepresented-repo',
        repo: repo.name,
        message: `Configured repo "${repo.name}" is not represented in indexed architecture diagrams.`
      });
    }
  }

  return dedupeFindings(findings);
}

function addAliases(aliases: Map<string, string>, value: string, canonical: string): void {
  for (const alias of componentAliases(value)) aliases.set(alias, canonical);
}

function componentAliases(value: string): string[] {
  const trimmed = value.trim();
  const withoutScope = trimmed.split('/').at(-1) ?? trimmed;
  return [...new Set([trimmed, withoutScope, trimmed.replace(/^@[^/]+\//, '')].map(normalizeComponent).filter(Boolean))];
}

function normalizeComponent(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function relationshipEndpoints(relationship: string): string[] {
  const cleaned = relationship
    .replace(/\|[^|]*\|/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]+\)|\{[^}]+\}/g, ' ')
    .replace(/["'`]/g, ' ');
  const parts = cleaned.split(/\s*(?:<[-.=]+>|[-.=]+>|->>|--)\s*/).map(part => part.trim()).filter(Boolean);
  return parts.length >= 2 ? [endpointToken(parts[0]), endpointToken(parts.at(-1) as string)].filter(Boolean) : [];
}

function endpointToken(value: string): string {
  return value.split(/\s+/)[0]?.replace(/[^A-Za-z0-9_./-]/g, '') ?? '';
}

function dedupeFindings(findings: DriftFinding[]): DriftFinding[] {
  const seen = new Set<string>();
  return findings.filter(finding => {
    const key = `${finding.type}:${finding.component ?? ''}:${finding.repo ?? ''}:${finding.relationship ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
