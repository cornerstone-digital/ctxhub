import path from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { CACHE_DIR, loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { attachFreshness } from '../context/freshness.js';
import { writeText } from '../utils/fs.js';
import type { CtxhubConfig, SearchResult } from '../config/types.js';

const RECENT_LIMIT = 40;

type ReportItem = {
  section: 'architecture' | 'recent' | 'memory';
  repo: string;
  path: string;
  title: string;
  snippet: string;
  lastIndexed?: string;
  stale: boolean;
  components?: string[];
  relationships?: string[];
  count?: number;
};

type ReportGraphNode = {
  id: string;
  label: string;
  type: 'repo' | 'file' | 'component' | 'memory-wing' | 'memory-room';
  repo?: string;
  path?: string;
  title?: string;
  snippet?: string;
  stale?: boolean;
};

type ReportGraphEdge = {
  source: string;
  target: string;
  type: 'contains' | 'documents' | 'depends-on' | 'memory-contains';
};

type ReportGraph = {
  nodes: ReportGraphNode[];
  edges: ReportGraphEdge[];
};

type ReportMemorySummary = {
  available: boolean;
  note?: string;
  totalDrawers?: number;
  items: ReportItem[];
};

export async function reportCommand(
  opts: { output?: string; open?: boolean; plain?: boolean; interactive?: boolean } = {},
  deps: { readMempalaceSummary?: typeof readMempalaceSummary } = {}
) {
  const cwd = process.cwd();
  const { config, workspaceRoot } = await loadWorkspaceConfig(cwd);
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const [status, diagramResults, recentDocs, memory] = await Promise.all([
    index.status(),
    index.search('architecture diagram mermaid', 100),
    index.recent(RECENT_LIMIT),
    (deps.readMempalaceSummary ?? readMempalaceSummary)(config)
  ]);

  const architecture = diagramResults.filter(result => result.kind === 'architecture-diagram');
  const recentAsResults: SearchResult[] = recentDocs.map(doc => ({
    ...doc,
    score: 0,
    snippet: doc.content.replace(/\s+/g, ' ').trim().slice(0, 240)
  }));
  const recent = await attachFreshness(config, recentAsResults, workspaceRoot);
  const stale = recent.filter(result => result.freshness?.stale);

  const output = opts.output ? path.resolve(cwd, opts.output) : path.resolve(workspaceRoot, CACHE_DIR, 'report.html');

  const items: ReportItem[] = [
    ...architecture.map<ReportItem>(item => ({
      section: 'architecture',
      repo: item.repo,
      path: item.filePath,
      title: item.title ?? item.diagramType ?? 'diagram',
      snippet: (item.relationships ?? []).join('; '),
      lastIndexed: item.lastIndexed,
      stale: false,
      components: item.components,
      relationships: item.relationships
    })),
    ...recent.map<ReportItem>(item => ({
      section: 'recent',
      repo: item.repo,
      path: item.filePath,
      title: item.title ?? item.filePath,
      snippet: item.snippet,
      lastIndexed: item.lastIndexed,
      stale: Boolean(item.freshness?.stale)
    })),
    ...memory.items
  ];
  const graph = buildReportGraphData(config.repositories.map(repo => ({ name: repo.name, path: repo.path })), items);

  await writeText(output, `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>ctxhub report: ${escapeHtml(config.workspace.name)}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:2rem;max-width:1280px;color:#1a1a1a}
  code,pre{background:#f6f8fa;padding:.2rem .4rem;border-radius:4px}
  li{margin:.35rem 0}
  input[type=search]{width:100%;box-sizing:border-box;padding:.5rem .75rem;font-size:1rem;margin:.5rem 0 1rem;border:1px solid #ccc;border-radius:6px}
  .item{border:1px solid #e2e2e2;border-radius:6px;padding:.6rem .8rem;margin:.5rem 0}
  .item.stale{border-color:#e0a800;background:#fffaf0}
  .item .meta{color:#666;font-size:.85rem}
  .badge{display:inline-block;font-size:.75rem;padding:.1rem .4rem;border-radius:4px;background:#eee;margin-left:.4rem}
  .badge.stale{background:#e0a800;color:#fff}
  .toolbar{display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem}
  .toolbar button{padding:.45rem .7rem;border:1px solid #ccc;border-radius:999px;background:#fff;cursor:pointer}
  .toolbar button.active{background:#1a1a1a;color:#fff;border-color:#1a1a1a}
  .view{display:none}
  .view.active{display:block}
  .graph-layout{display:grid;grid-template-columns:minmax(0,1fr) 320px;gap:1rem;align-items:start}
  .graph-wrap{border:1px solid #e2e2e2;border-radius:10px;padding:.75rem;background:linear-gradient(180deg,#fafbfc,#f5f7fa)}
  .graph-meta{display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem;font-size:.85rem;color:#666}
  .graph-legend{display:flex;gap:.5rem;flex-wrap:wrap}
  .legend{display:inline-flex;gap:.35rem;align-items:center;padding:.15rem .45rem;border-radius:999px;background:#fff;border:1px solid #ddd}
  .swatch{width:.7rem;height:.7rem;border-radius:999px;display:inline-block}
  .panel{border:1px solid #e2e2e2;border-radius:10px;padding:.9rem;background:#fff}
  .panel h3{margin-top:0}
  .panel ul{padding-left:1rem}
  .graph-svg{width:100%;height:680px;display:block}
  .graph-edge{stroke:#c7cdd4;stroke-width:1.2;opacity:.7}
  .graph-edge.depends-on{stroke:#7c8793;stroke-dasharray:5 4}
  .graph-edge.documents{stroke:#4a90e2}
  .graph-edge.hidden,.graph-node.hidden,.graph-label.hidden{display:none}
  .graph-node{cursor:pointer;stroke:#fff;stroke-width:2}
  .graph-node.repo{fill:#0f766e}
  .graph-node.file{fill:#2563eb}
  .graph-node.component{fill:#d97706}
  .graph-node.memory-wing{fill:#be185d}
  .graph-node.memory-room{fill:#7c3aed}
  .graph-node.stale{stroke:#e0a800;stroke-width:4}
  .graph-node.selected{stroke:#111827;stroke-width:4}
  .graph-label{font-size:11px;fill:#111827;pointer-events:none}
  .graph-empty{color:#666;font-size:.9rem}
  @media (prefers-color-scheme: dark) {
    body{background:#1a1a1a;color:#eee}
    code,pre{background:#2a2a2a}
    input[type=search]{background:#2a2a2a;color:#eee;border-color:#444}
    .item{border-color:#444}
    .item.stale{border-color:#e0a800;background:#3a3320}
    .item .meta{color:#aaa}
    .badge{background:#333}
    .toolbar button{background:#222;color:#eee;border-color:#444}
    .toolbar button.active{background:#eee;color:#111827;border-color:#eee}
    .graph-wrap{border-color:#444;background:linear-gradient(180deg,#20242b,#1a1d22)}
    .panel{border-color:#444;background:#20242b}
    .graph-meta{color:#aaa}
    .legend{background:#20242b;border-color:#444}
    .graph-edge{stroke:#5b6470}
    .graph-edge.depends-on{stroke:#939eaa}
    .graph-edge.documents{stroke:#6ea8fe}
    .graph-label{fill:#e5e7eb}
  }
  @media (max-width: 980px) {
    .graph-layout{grid-template-columns:1fr}
    .graph-svg{height:520px}
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
  <li>MemPalace: ${escapeHtml(memory.note ?? (memory.available ? `${memory.totalDrawers ?? 0} drawers` : 'not configured'))}</li>
</ul>

<h2>Repositories</h2>
<ul>${config.repositories.map(repo => `<li><strong>${escapeHtml(repo.name)}</strong> <code>${escapeHtml(repo.path)}</code></li>`).join('')}</ul>

<h2>Browse indexed knowledge</h2>
<input type="search" id="filter" placeholder="Filter by repo, path, title, or snippet...">
<div class="toolbar">
  <button id="list-view-button" class="active" type="button">List</button>
  <button id="graph-view-button" type="button">Graph</button>
  <div class="graph-legend">
    <span class="legend"><span class="swatch" style="background:#0f766e"></span>Repo</span>
    <span class="legend"><span class="swatch" style="background:#2563eb"></span>File</span>
    <span class="legend"><span class="swatch" style="background:#d97706"></span>Component</span>
    <span class="legend"><span class="swatch" style="background:#be185d"></span>Memory wing</span>
    <span class="legend"><span class="swatch" style="background:#7c3aed"></span>Memory room</span>
  </div>
</div>
<p class="meta"><span id="count"></span> — architecture diagrams, MemPalace wing/room summaries, and the ${RECENT_LIMIT} most recently indexed chunks. Items outlined in orange have drifted from their repo's current HEAD.</p>
<section id="list-view" class="view active">
  <ul id="items"></ul>
</section>
<section id="graph-view" class="view">
  <div class="graph-layout">
    <div class="graph-wrap">
      <div class="graph-meta">
        <span id="graph-count"></span>
        <span>Click a node to inspect it and its neighbors.</span>
      </div>
      <svg id="graph" class="graph-svg" viewBox="0 0 960 680" role="img" aria-label="Workspace knowledge graph"></svg>
      <p id="graph-empty" class="graph-empty hidden">No graph nodes match the current filter.</p>
    </div>
    <aside id="graph-panel" class="panel">
      <h3>Graph details</h3>
      <p>Select a repo, file, or component node to inspect linked knowledge.</p>
    </aside>
  </div>
</section>

<script id="ctxhub-report-data" type="application/json">${JSON.stringify(items).replaceAll('</', '<\\/')}</script>
<script id="ctxhub-report-graph" type="application/json">${JSON.stringify(graph).replaceAll('</', '<\/')}</script>
<script>
(function () {
  var items = JSON.parse(document.getElementById('ctxhub-report-data').textContent);
  var graph = JSON.parse(document.getElementById('ctxhub-report-graph').textContent);
  var list = document.getElementById('items');
  var count = document.getElementById('count');
  var graphCount = document.getElementById('graph-count');
  var filter = document.getElementById('filter');
  var listView = document.getElementById('list-view');
  var graphView = document.getElementById('graph-view');
  var listViewButton = document.getElementById('list-view-button');
  var graphViewButton = document.getElementById('graph-view-button');
  var graphSvg = document.getElementById('graph');
  var graphPanel = document.getElementById('graph-panel');
  var graphEmpty = document.getElementById('graph-empty');
  var selectedNodeId = null;
  var svgNs = 'http://www.w3.org/2000/svg';
  var graphElements = buildGraphElements(graph);

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
    renderGraph(q);
  }

  function buildGraphElements(graphData) {
    var width = 960;
    var height = 680;
    var centerX = width / 2;
    var centerY = height / 2;
    var repos = graphData.nodes.filter(function (node) { return node.type === 'repo'; });
    var files = graphData.nodes.filter(function (node) { return node.type === 'file'; });
    var components = graphData.nodes.filter(function (node) { return node.type === 'component'; });
    var positions = {};

    positionRing(repos, 120, 0);
    positionRing(files, Math.min(280, 180 + files.length * 4), Math.PI / 12);
    positionRing(components, Math.min(390, 310 + components.length * 3), Math.PI / 6);

    function positionRing(nodes, radius, offset) {
      if (!nodes.length) return;
      nodes.forEach(function (node, index) {
        var angle = offset + (Math.PI * 2 * index / nodes.length);
        positions[node.id] = {
          x: centerX + Math.cos(angle) * radius,
          y: centerY + Math.sin(angle) * radius
        };
      });
    }

    var edgeEls = graphData.edges.map(function (edge) {
      var source = positions[edge.source];
      var target = positions[edge.target];
      if (!source || !target) return null;
      var line = document.createElementNS(svgNs, 'line');
      line.setAttribute('x1', source.x);
      line.setAttribute('y1', source.y);
      line.setAttribute('x2', target.x);
      line.setAttribute('y2', target.y);
      line.setAttribute('class', 'graph-edge ' + edge.type);
      graphSvg.appendChild(line);
      return { data: edge, el: line };
    }).filter(Boolean);

    var nodeEls = graphData.nodes.map(function (node) {
      var position = positions[node.id];
      if (!position) return null;
      var radius = node.type === 'repo' ? 16 : node.type === 'file' ? 12 : 10;
      var circle = document.createElementNS(svgNs, 'circle');
      circle.setAttribute('cx', position.x);
      circle.setAttribute('cy', position.y);
      circle.setAttribute('r', radius);
      circle.setAttribute('class', 'graph-node ' + node.type + (node.stale ? ' stale' : ''));
      circle.addEventListener('click', function () {
        selectedNodeId = node.id;
        updateSelection();
      });
      graphSvg.appendChild(circle);

      var label = document.createElementNS(svgNs, 'text');
      label.setAttribute('x', position.x + radius + 6);
      label.setAttribute('y', position.y + 4);
      label.setAttribute('class', 'graph-label');
      label.textContent = node.label;
      graphSvg.appendChild(label);
      return { data: node, circle: circle, label: label };
    }).filter(Boolean);

    return { nodes: nodeEls, edges: edgeEls };
  }

  function renderGraph(query) {
    var q = (query || '').toLowerCase();
    var visibleNodeIds = new Set();

    graphElements.nodes.forEach(function (entry) {
      var haystack = [entry.data.label, entry.data.repo, entry.data.path, entry.data.title, entry.data.snippet].join(' ').toLowerCase();
      var visible = !q || haystack.indexOf(q) !== -1;
      entry.circle.classList.toggle('hidden', !visible);
      entry.label.classList.toggle('hidden', !visible);
      if (visible) visibleNodeIds.add(entry.data.id);
    });

    var visibleEdges = 0;
    graphElements.edges.forEach(function (entry) {
      var visible = visibleNodeIds.has(entry.data.source) && visibleNodeIds.has(entry.data.target);
      entry.el.classList.toggle('hidden', !visible);
      if (visible) visibleEdges++;
    });

    graphCount.textContent = visibleNodeIds.size + ' node(s), ' + visibleEdges + ' edge(s)';
    graphEmpty.classList.toggle('hidden', visibleNodeIds.size !== 0);
    updateSelection();
  }

  function updateSelection() {
    var selected = graphElements.nodes.find(function (entry) { return entry.data.id === selectedNodeId; });
    graphElements.nodes.forEach(function (entry) {
      entry.circle.classList.toggle('selected', selected && entry.data.id === selected.data.id);
    });

    if (!selected) {
      graphPanel.innerHTML = '<h3>Graph details<\/h3><p>Select a repo, file, or component node to inspect linked knowledge.<\/p>';
      return;
    }

    var neighbors = [];
    graphElements.edges.forEach(function (entry) {
      if (entry.data.source === selected.data.id) neighbors.push(entry.data.target + ' (' + entry.data.type + ')');
      else if (entry.data.target === selected.data.id) neighbors.push(entry.data.source + ' (' + entry.data.type + ')');
    });

    graphPanel.innerHTML = [
      '<h3>' + escapeHtml(selected.data.label) + '<\/h3>',
      '<p><strong>Type:<\/strong> ' + escapeHtml(selected.data.type) + (selected.data.stale ? ' <span class="badge stale">stale<\/span>' : '') + '<\/p>',
      selected.data.repo ? '<p><strong>Repo:<\/strong> ' + escapeHtml(selected.data.repo) + '<\/p>' : '',
      selected.data.path ? '<p><strong>Path:<\/strong> ' + escapeHtml(selected.data.path) + '<\/p>' : '',
      selected.data.title ? '<p><strong>Title:<\/strong> ' + escapeHtml(selected.data.title) + '<\/p>' : '',
      selected.data.snippet ? '<p><strong>Snippet:<\/strong> ' + escapeHtml(selected.data.snippet) + '<\/p>' : '',
      '<p><strong>Neighbors:<\/strong><\/p>',
      neighbors.length ? '<ul>' + neighbors.map(function (value) { return '<li>' + escapeHtml(value) + '<\/li>'; }).join('') + '<\/ul>' : '<p>None<\/p>'
    ].join('');
  }

  function activateView(view) {
    var listActive = view === 'list';
    listView.classList.toggle('active', listActive);
    graphView.classList.toggle('active', !listActive);
    listViewButton.classList.toggle('active', listActive);
    graphViewButton.classList.toggle('active', !listActive);
  }

  filter.addEventListener('input', function () { render(filter.value); });
  listViewButton.addEventListener('click', function () { activateView('list'); });
  graphViewButton.addEventListener('click', function () { activateView('graph'); });
  render('');
})();
</script>
</body>
</html>
`);
  console.log(chalk.green(`Wrote report: ${path.relative(cwd, output) || output}`));
  console.log(chalk.gray(`${status.chunkCount} chunks · ${architecture.length} architecture item(s) · ${stale.length} stale recent chunk(s)`));
  console.log(chalk.gray(`Open: ${output}`));

  if (opts.open && !opts.plain && opts.interactive !== false) {
    openReport(output);
    console.log(chalk.gray('Opening report in your browser...'));
  }
}

export function openReport(filePath: string): void {
  const { command, args } = openReportCommand(filePath, process.platform);
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.unref();
}

export function openReportCommand(filePath: string, platform: NodeJS.Platform): { command: string; args: string[] } {
  if (platform === 'darwin') return { command: 'open', args: [filePath] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', filePath] };
  return { command: 'xdg-open', args: [filePath] };
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

export function buildReportGraphData(
  repositories: Array<{ name: string; path: string }>,
  items: ReportItem[]
): ReportGraph {
  const nodes = new Map<string, ReportGraphNode>();
  const edges = new Map<string, ReportGraphEdge>();

  for (const repo of repositories) {
    nodes.set(`repo:${repo.name}`, { id: `repo:${repo.name}`, label: repo.name, type: 'repo', repo: repo.name, path: repo.path });
  }

  for (const item of items) {
    if (item.section === 'memory') {
      const wingId = `memory-wing:${item.repo}`;
      const roomId = `memory-room:${item.repo}:${item.path}`;
      if (!nodes.has(wingId)) {
        nodes.set(wingId, {
          id: wingId,
          label: item.repo,
          type: 'memory-wing',
          repo: item.repo,
          title: `MemPalace wing ${item.repo}`,
          snippet: item.snippet
        });
      }
      if (!nodes.has(roomId)) {
        nodes.set(roomId, {
          id: roomId,
          label: item.path,
          type: 'memory-room',
          repo: item.repo,
          path: item.path,
          title: item.title,
          snippet: item.snippet
        });
      }
      addEdge(edges, { source: wingId, target: roomId, type: 'memory-contains' });
      continue;
    }

    const repoId = `repo:${item.repo}`;
    const fileId = `file:${item.repo}:${item.path}`;
    if (!nodes.has(fileId)) {
      nodes.set(fileId, {
        id: fileId,
        label: item.path.split('/').at(-1) ?? item.path,
        type: 'file',
        repo: item.repo,
        path: item.path,
        title: item.title,
        snippet: item.snippet,
        stale: item.stale
      });
    }
    addEdge(edges, { source: repoId, target: fileId, type: 'contains' });

    for (const component of item.components ?? []) {
      const componentId = `component:${component}`;
      if (!nodes.has(componentId)) {
        nodes.set(componentId, { id: componentId, label: component, type: 'component', repo: item.repo });
      }
      addEdge(edges, { source: fileId, target: componentId, type: 'documents' });
    }

    for (const relationship of item.relationships ?? []) {
      const endpoints = relationshipEndpoints(relationship);
      if (!endpoints) continue;
      const sourceId = `component:${endpoints[0]}`;
      const targetId = `component:${endpoints[1]}`;
      if (!nodes.has(sourceId)) nodes.set(sourceId, { id: sourceId, label: endpoints[0], type: 'component', repo: item.repo });
      if (!nodes.has(targetId)) nodes.set(targetId, { id: targetId, label: endpoints[1], type: 'component', repo: item.repo });
      addEdge(edges, { source: sourceId, target: targetId, type: 'depends-on' });
    }
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()]
  };
}

function addEdge(edges: Map<string, ReportGraphEdge>, edge: ReportGraphEdge): void {
  const key = `${edge.source}:${edge.type}:${edge.target}`;
  if (!edges.has(key)) edges.set(key, edge);
}

function relationshipEndpoints(relationship: string): [string, string] | undefined {
  const cleaned = relationship.replace(/\|[^|]*\|/g, ' ');
  const matches = [...cleaned.matchAll(/[A-Za-z][A-Za-z0-9_./-]*/g)].map(match => match[0]).filter(token => !isNoiseToken(token));
  if (matches.length < 2) return undefined;
  return [matches[0], matches[matches.length - 1]];
}

function isNoiseToken(token: string): boolean {
  return ['flowchart', 'graph', 'sequenceDiagram', 'classDiagram', 'LR', 'TD', 'TB', 'BT', 'RL'].includes(token);
}

export async function readMempalaceSummary(config: CtxhubConfig): Promise<ReportMemorySummary> {
  if (config.memory.provider !== 'mempalace') {
    return { available: false, note: 'disabled (memory.provider is not mempalace)', items: [] };
  }

  const result = await runCli('mempalace', ['status']);
  const combined = `${result.stdout}\n${result.stderr}`.trim();

  if (combined.includes('No palace found')) {
    return { available: false, note: 'no palace found; run mempalace init <dir> then mempalace mine <dir>', items: [] };
  }

  if (result.exitCode !== 0) {
    return { available: false, note: `status unavailable (exit ${result.exitCode})`, items: [] };
  }

  const parsed = parseMempalaceStatus(combined);
  return {
    available: true,
    totalDrawers: parsed.totalDrawers,
    note: `${parsed.totalDrawers ?? 0} drawers across ${parsed.items.length} room(s)`,
    items: parsed.items
  };
}

export function parseMempalaceStatus(output: string): { totalDrawers?: number; items: ReportItem[] } {
  const totalDrawers = output.match(/MemPalace Status\s+—\s+(\d+) drawers/)?.[1];
  const lines = output.split('\n');
  const items: ReportItem[] = [];
  let currentWing: string | undefined;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const wingMatch = line.match(/^\s*WING:\s+(.+)$/);
    if (wingMatch) {
      currentWing = wingMatch[1].trim();
      continue;
    }

    const roomMatch = line.match(/^\s*ROOM:\s+(.+?)\s+(\d+) drawers$/);
    if (roomMatch && currentWing) {
      const room = roomMatch[1].trim();
      const count = Number(roomMatch[2]);
      items.push({
        section: 'memory',
        repo: currentWing,
        path: room,
        title: `${currentWing} / ${room}`,
        snippet: `${count} drawer${count === 1 ? '' : 's'} in MemPalace`,
        stale: false,
        count
      });
    }
  }

  return { totalDrawers: totalDrawers ? Number(totalDrawers) : undefined, items };
}

async function runCli(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise(resolve => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', chunk => (stdout += String(chunk)));
    child.stderr?.on('data', chunk => (stderr += String(chunk)));
    child.on('error', error => resolve({ stdout, stderr: `${stderr}${error.message}`, exitCode: 1 }));
    child.on('close', exitCode => resolve({ stdout, stderr, exitCode: exitCode ?? 1 }));
  });
}
