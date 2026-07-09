import path from 'node:path';
import { CACHE_DIR, loadConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { writeText } from '../utils/fs.js';

export async function reportCommand(opts: { output?: string } = {}) {
  const config = await loadConfig();
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table);
  const [status, diagrams] = await Promise.all([
    index.status(),
    index.search('architecture diagram mermaid', 100)
  ]);
  const architecture = diagrams.filter(result => result.kind === 'architecture-diagram');
  const output = path.resolve(process.cwd(), opts.output ?? path.join(CACHE_DIR, 'report.html'));

  await writeText(output, `<!doctype html>
<html>
<head><meta charset="utf-8"><title>ctxhub report</title><style>body{font-family:system-ui;margin:2rem;max-width:1100px}code,pre{background:#f6f8fa;padding:.2rem .4rem;border-radius:4px}li{margin:.35rem 0}</style></head>
<body>
<h1>${escapeHtml(config.workspace.name)}</h1>
<p>Generated ${new Date().toISOString()}</p>
<h2>Status</h2>
<ul><li>Index: ${status.provider}</li><li>Chunks: ${status.chunkCount}</li><li>Last indexed: ${status.lastIndexed ?? 'never'}</li></ul>
<h2>Repositories</h2>
<ul>${config.repositories.map(repo => `<li><strong>${escapeHtml(repo.name)}</strong> <code>${escapeHtml(repo.path)}</code></li>`).join('')}</ul>
<h2>Architecture</h2>
<ul>${architecture.map(item => `<li><strong>${escapeHtml(item.repo)}</strong> ${escapeHtml(item.filePath)} ${item.diagramType ? `(${escapeHtml(item.diagramType)})` : ''}<br><small>${escapeHtml((item.relationships ?? []).join('; '))}</small></li>`).join('')}</ul>
</body>
</html>
`);
  console.log(output);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
