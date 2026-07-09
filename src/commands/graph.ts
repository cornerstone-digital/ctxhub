import path from 'node:path';
import { loadConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { pathExists, readText } from '../utils/fs.js';

export async function graphCommand(opts: { json?: boolean } = {}) {
  const config = await loadConfig();
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table);
  const diagrams = (await index.search('architecture diagram mermaid', 100)).filter(result => result.kind === 'architecture-diagram');
  const packages = [];

  for (const repo of config.repositories) {
    const packagePath = path.resolve(process.cwd(), repo.path, 'package.json');
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

  if (opts.json) {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }

  console.log(`# ${graph.workspace}`);
  console.log('\n## Components');
  for (const component of graph.components) console.log(`- ${component}`);
  console.log('\n## Relationships');
  for (const relationship of graph.relationships) console.log(`- ${relationship}`);
  console.log('\n## Packages');
  for (const pkg of graph.packages) console.log(`- ${pkg.repo}: ${pkg.package ?? '(unnamed)'}`);
}
