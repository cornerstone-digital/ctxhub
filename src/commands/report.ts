import path from 'node:path';
import { CACHE_DIR, loadConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { attachFreshness } from '../context/freshness.js';
import { writeText } from '../utils/fs.js';
import type { SearchResult } from '../config/types.js';

const RECENT_LIMIT = 40;

export async function reportCommand(opts: { output?: string } = {}) {
  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, cwd);
  const [status, diagramResults, recentDocs] = await Promise.all([
    index.status(),
    index.search('architecture diagram mermaid', 100),
    index.recent(RECENT_LIMIT)
  ]);

  const architecture = diagramResults.filter(result => result.kind === 'architecture-diagram');
  const recentAsResults: SearchResult[] = recentDocs.map(doc => ({
    ...doc,
    score: 0,
    snippet: doc.content.replace(/\s+/g, ' ').trim().slice(0, 240)
  }));
  const recent = await attachFreshness(config, recentAsResults, cwd);
  const stale = recent.filter(result => result.freshness?.stale);

  const output = path.resolve(cwd, opts.output ?? path.join(CACHE_DIR, 'report.html'));

  const items = [
    ...architecture.map(item => ({
      section: 'architecture',
      repo: item.repo,
      path: item.filePath,
      title: item.title ?? item.diagramType ?? 'diagram',
      snippet: (item.relationships ?? []).join('; '),
      lastIndexed: item.lastIndexed,
      stale: false
    })),
    ...recent.map(item => ({
      section: 'recent',
      repo: item.repo,
      path: item.filePath,
      title: item.title ?? item.filePath,
      snippet: item.snippet,
      lastIndexed: item.lastIndexed,
      stale: Boolean(item.freshness?.stale)
    }))
  ];

  await writeText(output, `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>ctxhub report: ${escapeHtml(config.workspace.name)}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:2rem;max-width:1100px;color:#1a1a1a}
  code,pre{background:#f6f8fa;padding:.2rem .4rem;border-radius:4px}
  li{margin:.35rem 0}
  input[type=search]{width:100%;box-sizing:border-box;padding:.5rem .75rem;font-size:1rem;margin:.5rem 0 1rem;border:1px solid #ccc;border-radius:6px}
  .item{border:1px solid #e2e2e2;border-radius:6px;padding:.6rem .8rem;margin:.5rem 0}
  .item.stale{border-color:#e0a800;background:#fffaf0}
  .item .meta{color:#666;font-size:.85rem}
  .badge{display:inline-block;font-size:.75rem;padding:.1rem .4rem;border-radius:4px;background:#eee;margin-left:.4rem}
  .badge.stale{background:#e0a800;color:#fff}
  .hidden{display:none}
  @media (prefers-color-scheme: dark) {
    body{background:#1a1a1a;color:#eee}
    code,pre{background:#2a2a2a}
    input[type=search]{background:#2a2a2a;color:#eee;border-color:#444}
    .item{border-color:#444}
    .item.stale{border-color:#e0a800;background:#3a3320}
    .item .meta{color:#aaa}
    .badge{background:#333}
  }
</style>
</head>
<body>
<h1>${escapeHtml(config.workspace.name)}</h1>
<p class="meta">Generated ${new Date().toISOString()}</p>

<h2>Status</h2>
<ul>
  <li>Index: ${status.provider}</li>
  <li>Chunks: ${status.chunkCount}</li>
  <li>Last indexed: ${status.lastIndexed ?? 'never'}</li>
  <li>Stale results found: ${stale.length}</li>
</ul>

<h2>Repositories</h2>
<ul>${config.repositories.map(repo => `<li><strong>${escapeHtml(repo.name)}</strong> <code>${escapeHtml(repo.path)}</code></li>`).join('')}</ul>

<h2>Browse indexed knowledge</h2>
<input type="search" id="filter" placeholder="Filter by repo, path, title, or snippet...">
<p class="meta"><span id="count"></span> — architecture diagrams and the ${RECENT_LIMIT} most recently indexed chunks. Items outlined in orange have drifted from their repo's current HEAD.</p>
<ul id="items"></ul>

<script id="ctxhub-report-data" type="application/json">${JSON.stringify(items).replaceAll('</', '<\\/')}</script>
<script>
(function () {
  var items = JSON.parse(document.getElementById('ctxhub-report-data').textContent);
  var list = document.getElementById('items');
  var count = document.getElementById('count');
  var filter = document.getElementById('filter');

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  function render(query) {
    var q = (query || '').toLowerCase();
    var shown = 0;
    list.innerHTML = items
      .filter(function (item) {
        if (!q) return true;
        return [item.repo, item.path, item.title, item.snippet].join(' ').toLowerCase().indexOf(q) !== -1;
      })
      .map(function (item) {
        shown++;
        var badges = '<span class="badge">' + escapeHtml(item.section) + '</span>' +
          (item.stale ? '<span class="badge stale">stale</span>' : '');
        return '<li class="item' + (item.stale ? ' stale' : '') + '">' +
          '<strong>' + escapeHtml(item.repo) + '</strong> ' + escapeHtml(item.path) + badges +
          '<div class="meta">' + escapeHtml(item.title) + (item.lastIndexed ? ' &middot; indexed ' + escapeHtml(item.lastIndexed) : '') + '</div>' +
          (item.snippet ? '<div>' + escapeHtml(item.snippet) + '</div>' : '') +
          '</li>';
      })
      .join('');
    count.textContent = shown + ' of ' + items.length + ' item(s)';
  }

  filter.addEventListener('input', function () { render(filter.value); });
  render('');
})();
</script>
</body>
</html>
`);
  console.log(output);
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
