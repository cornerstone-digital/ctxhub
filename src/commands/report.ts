import path from 'node:path';
import { spawn } from 'node:child_process';
import chalk from 'chalk';
import { CACHE_DIR, loadWorkspaceConfig } from '../config/config.js';
import { createIndexProvider } from '../indexing/providers.js';
import { attachFreshness } from '../context/freshness.js';
import { writeText } from '../utils/fs.js';
import type { SearchResult } from '../config/types.js';
import { readMempalaceStatusSummary, searchMempalace, timelineMempalace } from '../memory/mempalaceCli.js';

const RECENT_LIMIT = 40;

type ReportItem = {
  section: 'architecture' | 'recent' | 'memory' | 'memory-hit';
  repo: string;
  path: string;
  title: string;
  snippet: string;
  lastIndexed?: string;
  stale: boolean;
  components?: string[];
  relationships?: string[];
  count?: number;
  // Provenance (NEXT_FEATURES #23) -- populated for memory-hit items today; index-backed items
  // (architecture/recent) already carry recency via `lastIndexed`. `sourceFile` is the file a
  // MemPalace hit says it's about, used to build backlinks to the matching file node below.
  sourceFile?: string;
  timestamp?: string;
};

type ReportGraphNode = {
  id: string;
  label: string;
  type: 'repo' | 'file' | 'component' | 'memory-wing' | 'memory-room' | 'memory-hit';
  repo?: string;
  path?: string;
  title?: string;
  snippet?: string;
  stale?: boolean;
  sourceFile?: string;
  timestamp?: string;
};

type ReportGraphEdge = {
  source: string;
  target: string;
  type: 'contains' | 'documents' | 'depends-on' | 'memory-contains' | 'memory-match' | 'documented-by';
};

type ReportGraph = {
  nodes: ReportGraphNode[];
  edges: ReportGraphEdge[];
};

type ReportMempalaceSummary = {
  available: boolean;
  note?: string;
  totalDrawers?: number;
  items: ReportItem[];
};

type ReportTimelineEvent = {
  label: string;
  detail: string;
  subject?: string;
  object?: string;
};

type ReportTimeline = {
  note: string;
  events: ReportTimelineEvent[];
  // NEXT_FEATURES #22: the full set of distinct entities across all embedded events, so the
  // in-page timeline-entity control has something to populate without the client re-deriving it.
  entities: string[];
  selectedEntity?: string;
};

export async function reportCommand(
  opts: {
    output?: string;
    open?: boolean;
    plain?: boolean;
    interactive?: boolean;
    memoryQuery?: string;
    memoryWing?: string;
    memoryRoom?: string;
    memoryLimit?: string;
    timelineEntity?: string;
    timelineLimit?: string;
  } = {},
  deps: {
    readMempalaceSummary?: typeof readMempalaceSummary;
    searchMempalaceFn?: typeof searchMempalace;
    timelineMempalaceFn?: typeof timelineMempalace;
  } = {}
) {
  const cwd = process.cwd();
  const { config, workspaceRoot } = await loadWorkspaceConfig(cwd);
  const index = createIndexProvider(config.index.provider, config.index.path, config.index.table, workspaceRoot);
  const [status, diagramResults, recentDocs, memory, memoryHits, timeline] = await Promise.all([
    index.status(),
    index.search('architecture diagram mermaid', 100),
    index.recent(RECENT_LIMIT),
    (deps.readMempalaceSummary ?? readMempalaceSummary)(config),
    opts.memoryQuery
      ? (deps.searchMempalaceFn ?? searchMempalace)(config, workspaceRoot, {
          query: opts.memoryQuery,
          wing: opts.memoryWing,
          room: opts.memoryRoom,
          limit: Number(opts.memoryLimit ?? 8)
        })
      : Promise.resolve(undefined),
    // NEXT_FEATURES #22: always fetch the broad, unfiltered timeline -- entity selection becomes
    // an in-page control (see buildReportTimeline below) instead of something the user must decide
    // at generation time. `opts.timelineEntity`, if given, only pre-selects that control.
    (deps.timelineMempalaceFn ?? timelineMempalace)(config, workspaceRoot, { entity: undefined })
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
    ...memory.items,
    ...reportMemorySearchItems(memoryHits)
  ];
  const graph = buildReportGraphData(config.repositories.map(repo => ({ name: repo.name, path: repo.path })), items);
  const reportTimeline = buildReportTimeline(timeline, Number(opts.timelineLimit ?? 40), opts.timelineEntity);

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
  .scope-controls{display:flex;gap:1rem;flex-wrap:wrap;align-items:center;margin:0 0 .35rem}
  .scope-controls label{display:flex;gap:.4rem;align-items:center;font-size:.9rem}
  .scope-controls select{padding:.3rem .5rem;border:1px solid #ccc;border-radius:6px;font:inherit}
  .scope-hint{margin:0 0 1rem}
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
  .graph-node.memory-hit{fill:#ea580c}
  .graph-node.stale{stroke:#e0a800;stroke-width:4}
  .graph-node.selected{stroke:#111827;stroke-width:4}
  .graph-label{font-size:11px;fill:#111827;pointer-events:none}
  .graph-empty{color:#666;font-size:.9rem}
  .timeline-list{list-style:none;padding:0;margin:0}
  .timeline-item{border-left:3px solid #cbd5e1;padding:.65rem .85rem;margin:0 0 .75rem .35rem;background:#fff;border-radius:0 8px 8px 0}
  .timeline-item .meta{color:#666;font-size:.85rem;margin-bottom:.2rem}
  @media (prefers-color-scheme: dark) {
    body{background:#1a1a1a;color:#eee}
    code,pre{background:#2a2a2a}
    input[type=search]{background:#2a2a2a;color:#eee;border-color:#444}
    .scope-controls select{background:#2a2a2a;color:#eee;border-color:#444}
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
    .timeline-item{background:#20242b;border-left-color:#475569}
    .timeline-item .meta{color:#aaa}
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
<div class="scope-controls">
  <label>Wing <select id="wing-filter"><option value="">All</option></select></label>
  <label>Room <select id="room-filter"><option value="">All</option></select></label>
  <label>Timeline entity <select id="timeline-entity-filter"><option value="">All</option></select></label>
</div>
<p class="meta scope-hint">Wing, room, and timeline entity filters apply immediately to what's already in this report. To pull in memory hits for a new free-text query, regenerate with <code>ctxhub report --memory-query "..."</code>.</p>
<div class="toolbar">
  <button id="list-view-button" class="active" type="button">List</button>
  <button id="graph-view-button" type="button">Graph</button>
  <button id="timeline-view-button" type="button">Timeline</button>
  <div class="graph-legend">
    <span class="legend"><span class="swatch" style="background:#0f766e"></span>Repo</span>
    <span class="legend"><span class="swatch" style="background:#2563eb"></span>File</span>
    <span class="legend"><span class="swatch" style="background:#d97706"></span>Component</span>
    <span class="legend"><span class="swatch" style="background:#be185d"></span>Memory wing</span>
    <span class="legend"><span class="swatch" style="background:#7c3aed"></span>Memory room</span>
    <span class="legend"><span class="swatch" style="background:#ea580c"></span>Memory hit</span>
  </div>
</div>
<p class="meta"><span id="count"></span> — architecture diagrams, MemPalace wing/room summaries, optional memory search hits, and the ${RECENT_LIMIT} most recently indexed chunks. Items outlined in orange have drifted from their repo's current HEAD.</p>
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
<section id="timeline-view" class="view">
  <div class="panel">
    <h3>MemPalace timeline</h3>
    <p class="meta" id="timeline-note"></p>
    <ul id="timeline-items" class="timeline-list"></ul>
  </div>
</section>

<script id="ctxhub-report-data" type="application/json">${JSON.stringify(items).replaceAll('</', '<\\/')}</script>
<script id="ctxhub-report-graph" type="application/json">${JSON.stringify(graph).replaceAll('</', '<\\/')}</script>
<script id="ctxhub-report-timeline" type="application/json">${JSON.stringify(reportTimeline).replaceAll('</', '<\\/')}</script>
<script>
(function () {
  var items = JSON.parse(document.getElementById('ctxhub-report-data').textContent);
  var graph = JSON.parse(document.getElementById('ctxhub-report-graph').textContent);
  var timeline = JSON.parse(document.getElementById('ctxhub-report-timeline').textContent);
  var list = document.getElementById('items');
  var count = document.getElementById('count');
  var graphCount = document.getElementById('graph-count');
  var filter = document.getElementById('filter');
  var wingFilter = document.getElementById('wing-filter');
  var roomFilter = document.getElementById('room-filter');
  var timelineEntityFilter = document.getElementById('timeline-entity-filter');
  var listView = document.getElementById('list-view');
  var graphView = document.getElementById('graph-view');
  var timelineView = document.getElementById('timeline-view');
  var listViewButton = document.getElementById('list-view-button');
  var graphViewButton = document.getElementById('graph-view-button');
  var timelineViewButton = document.getElementById('timeline-view-button');
  var graphSvg = document.getElementById('graph');
  var graphPanel = document.getElementById('graph-panel');
  var graphEmpty = document.getElementById('graph-empty');
  var timelineNote = document.getElementById('timeline-note');
  var timelineItems = document.getElementById('timeline-items');
  var selectedNodeId = null;
  var svgNs = 'http://www.w3.org/2000/svg';
  var graphElements = buildGraphElements(graph);
  var memoryItems = items.filter(function (item) { return item.section === 'memory' || item.section === 'memory-hit'; });

  function populateSelect(select, values) {
    values.forEach(function (value) {
      var option = document.createElement('option');
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
  }

  function refreshRoomOptions() {
    var wing = wingFilter.value;
    var rooms = Array.from(new Set(memoryItems
      .filter(function (item) { return !wing || item.repo === wing; })
      .map(function (item) { return item.path; })
    )).sort();
    var current = roomFilter.value;
    roomFilter.innerHTML = '<option value="">All</option>';
    populateSelect(roomFilter, rooms);
    roomFilter.value = rooms.indexOf(current) !== -1 ? current : '';
  }

  function matchesMemoryScope(repo, path, isWingLevel) {
    if (wingFilter.value && repo !== wingFilter.value) return false;
    // A wing-level graph node has no room of its own -- don't hide it just because a specific
    // room is selected, or its child room node loses visible context for which wing it's under.
    if (!isWingLevel && roomFilter.value && path !== roomFilter.value) return false;
    return true;
  }

  var memoryWings = Array.from(new Set(memoryItems.map(function (item) { return item.repo; }))).sort();
  populateSelect(wingFilter, memoryWings);
  refreshRoomOptions();
  populateSelect(timelineEntityFilter, timeline.entities || []);
  if (timeline.selectedEntity) timelineEntityFilter.value = timeline.selectedEntity;

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
  }

  function render(query) {
    var q = (query || '').toLowerCase();
    var shown = 0;
    list.innerHTML = items
      .filter(function (item) {
        var isMemoryItem = item.section === 'memory' || item.section === 'memory-hit';
        if (isMemoryItem && !matchesMemoryScope(item.repo, item.path)) return false;
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
    renderTimeline(q);
  }

  function buildGraphElements(graphData) {
    var width = 960;
    var height = 680;
    var centerX = width / 2;
    var centerY = height / 2;
    var repos = graphData.nodes.filter(function (node) { return node.type === 'repo'; });
    var files = graphData.nodes.filter(function (node) { return node.type === 'file'; });
    var components = graphData.nodes.filter(function (node) { return node.type === 'component'; });
    var memoryWings = graphData.nodes.filter(function (node) { return node.type === 'memory-wing'; });
    var memoryRooms = graphData.nodes.filter(function (node) { return node.type === 'memory-room'; });
    var memoryHits = graphData.nodes.filter(function (node) { return node.type === 'memory-hit'; });
    var positions = {};

    positionRing(repos, 120, 0);
    positionRing(files, Math.min(280, 180 + files.length * 4), Math.PI / 12);
    positionRing(components, Math.min(390, 310 + components.length * 3), Math.PI / 6);
    positionRing(memoryWings, 220, Math.PI / 8);
    positionRing(memoryRooms, Math.min(500, 380 + memoryRooms.length * 4), Math.PI / 4);
    positionRing(memoryHits, Math.min(620, 470 + memoryHits.length * 4), Math.PI / 3);

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
      var isMemoryNode = entry.data.type === 'memory-wing' || entry.data.type === 'memory-room' || entry.data.type === 'memory-hit';
      var inScope = !isMemoryNode || matchesMemoryScope(entry.data.repo, entry.data.path, entry.data.type === 'memory-wing');
      var haystack = [entry.data.label, entry.data.repo, entry.data.path, entry.data.title, entry.data.snippet].join(' ').toLowerCase();
      var visible = inScope && (!q || haystack.indexOf(q) !== -1);
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

  function renderTimeline(query) {
    var q = (query || '').toLowerCase();
    timelineNote.textContent = timeline.note;
    var shown = 0;
    timelineItems.innerHTML = timeline.events
      .filter(function (event) {
        var entity = timelineEntityFilter.value;
        if (entity && event.subject !== entity && event.object !== entity) return false;
        if (!q) return true;
        return (event.label + ' ' + event.detail).toLowerCase().indexOf(q) !== -1;
      })
      .map(function (event) {
        shown++;
        return '<li class="timeline-item">' +
          '<div class="meta">' + escapeHtml(event.label) + '</div>' +
          '<div>' + escapeHtml(event.detail) + '</div>' +
          '</li>';
      })
      .join('');
    if (!shown) {
      timelineItems.innerHTML = '<li class="timeline-item"><div>No timeline events match the current filter.</div></li>';
    }
  }

  function updateSelection() {
    var selected = graphElements.nodes.find(function (entry) { return entry.data.id === selectedNodeId; });
    graphElements.nodes.forEach(function (entry) {
      entry.circle.classList.toggle('selected', selected && entry.data.id === selected.data.id);
    });

    if (!selected) {
      graphPanel.innerHTML = '<h3>Graph details</h3><p>Select a repo, file, or component node to inspect linked knowledge.</p>';
      return;
    }

    var neighbors = [];
    graphElements.edges.forEach(function (entry) {
      if (entry.data.source === selected.data.id) neighbors.push(entry.data.target + ' (' + entry.data.type + ')');
      else if (entry.data.target === selected.data.id) neighbors.push(entry.data.source + ' (' + entry.data.type + ')');
    });

    graphPanel.innerHTML = [
      '<h3>' + escapeHtml(selected.data.label) + '</h3>',
      '<p><strong>Type:</strong> ' + escapeHtml(selected.data.type) + (selected.data.stale ? ' <span class="badge stale">stale</span>' : '') + '</p>',
      selected.data.repo ? '<p><strong>Repo:</strong> ' + escapeHtml(selected.data.repo) + '</p>' : '',
      selected.data.path ? '<p><strong>Path:</strong> ' + escapeHtml(selected.data.path) + '</p>' : '',
      selected.data.title ? '<p><strong>Title:</strong> ' + escapeHtml(selected.data.title) + '</p>' : '',
      selected.data.snippet ? '<p><strong>Snippet:</strong> ' + escapeHtml(selected.data.snippet) + '</p>' : '',
      '<p><strong>Neighbors:</strong></p>',
      neighbors.length ? '<ul>' + neighbors.map(function (value) { return '<li>' + escapeHtml(value) + '</li>'; }).join('') + '</ul>' : '<p>None</p>'
    ].join('');
  }

  function activateView(view) {
    var listActive = view === 'list';
    var graphActive = view === 'graph';
    var timelineActive = view === 'timeline';
    listView.classList.toggle('active', listActive);
    graphView.classList.toggle('active', graphActive);
    timelineView.classList.toggle('active', timelineActive);
    listViewButton.classList.toggle('active', listActive);
    graphViewButton.classList.toggle('active', graphActive);
    timelineViewButton.classList.toggle('active', timelineActive);
  }

  filter.addEventListener('input', function () { render(filter.value); });
  wingFilter.addEventListener('change', function () { refreshRoomOptions(); render(filter.value); });
  roomFilter.addEventListener('change', function () { render(filter.value); });
  timelineEntityFilter.addEventListener('change', function () { render(filter.value); });
  listViewButton.addEventListener('click', function () { activateView('list'); });
  graphViewButton.addEventListener('click', function () { activateView('graph'); });
  timelineViewButton.addEventListener('click', function () { activateView('timeline'); });
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

    if (item.section === 'memory-hit') {
      const wingId = `memory-wing:${item.repo}`;
      const roomId = `memory-room:${item.repo}:${item.path}`;
      const hitId = `memory-hit:${item.repo}:${item.path}:${item.title}`;
      if (!nodes.has(wingId)) {
        nodes.set(wingId, { id: wingId, label: item.repo, type: 'memory-wing', repo: item.repo, title: `MemPalace wing ${item.repo}` });
      }
      if (!nodes.has(roomId)) {
        nodes.set(roomId, { id: roomId, label: item.path, type: 'memory-room', repo: item.repo, path: item.path, title: `${item.repo} / ${item.path}` });
      }
      if (!nodes.has(hitId)) {
        nodes.set(hitId, {
          id: hitId,
          label: item.title,
          type: 'memory-hit',
          repo: item.repo,
          path: item.path,
          title: item.title,
          snippet: item.snippet,
          sourceFile: item.sourceFile,
          timestamp: item.timestamp
        });
      }
      addEdge(edges, { source: wingId, target: roomId, type: 'memory-contains' });
      addEdge(edges, { source: roomId, target: hitId, type: 'memory-match' });
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

  // Runs after every item has already produced its node (architecture/recent items always
  // precede memory-hit items in the array `reportCommand` builds), so every id these edges
  // reference is guaranteed to already exist in `nodes`.
  for (const edge of buildProvenanceBacklinks(items)) {
    if (nodes.has(edge.source) && nodes.has(edge.target)) addEdge(edges, edge);
  }

  return {
    nodes: [...nodes.values()],
    edges: [...edges.values()]
  };
}

// NEXT_FEATURES #23: cross-links between a memory hit and the repo file it says it's about, when
// we can tell. MemPalace's `wing` is a free-text project label, not guaranteed to equal a
// configured repo name, so this is a best-effort heuristic -- exact repo+path match first,
// falling back to a path-only match against any repo -- not a guaranteed link. No match is a
// normal, expected outcome, not an error.
export function buildProvenanceBacklinks(items: ReportItem[]): ReportGraphEdge[] {
  const fileItemsByRepoPath = new Map<string, ReportItem>();
  const fileItemsByPath = new Map<string, ReportItem>();
  for (const item of items) {
    if (item.section !== 'architecture' && item.section !== 'recent') continue;
    fileItemsByRepoPath.set(`${item.repo}:${item.path}`, item);
    if (!fileItemsByPath.has(item.path)) fileItemsByPath.set(item.path, item);
  }

  const edges: ReportGraphEdge[] = [];
  for (const item of items) {
    if (item.section !== 'memory-hit' || !item.sourceFile) continue;
    const matched = fileItemsByRepoPath.get(`${item.repo}:${item.sourceFile}`) ?? fileItemsByPath.get(item.sourceFile);
    if (!matched) continue;
    edges.push({
      source: `memory-hit:${item.repo}:${item.path}:${item.title}`,
      target: `file:${matched.repo}:${matched.path}`,
      type: 'documented-by'
    });
  }
  return edges;
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

export async function readMempalaceSummary(config: Parameters<typeof readMempalaceStatusSummary>[0], workspaceRoot = process.cwd()): Promise<ReportMempalaceSummary> {
  const summary = await readMempalaceStatusSummary(config, workspaceRoot);
  return {
    ...summary,
    items: summary.items.map(item => ({
      section: 'memory',
      repo: item.wing,
      path: item.room,
      title: `${item.wing} / ${item.room}`,
      snippet: `${item.count} drawer${item.count === 1 ? '' : 's'} in MemPalace`,
      stale: false,
      count: item.count
    }))
  };
}

function reportMemorySearchItems(memoryHits: Awaited<ReturnType<typeof searchMempalace>> | undefined): ReportItem[] {
  if (!memoryHits || memoryHits.error) return [];
  return memoryHits.results.map(hit => ({
    section: 'memory-hit',
    repo: hit.wing,
    path: hit.room,
    title: hit.source_file ?? `${hit.wing} memory`,
    snippet: hit.text.replace(/\s+/g, ' ').trim().slice(0, 280),
    stale: false,
    sourceFile: hit.source_file,
    timestamp: hit.created_at
  }));
}

function buildReportTimeline(
  timeline: Awaited<ReturnType<typeof timelineMempalace>>,
  limit: number,
  selectedEntity?: string
): ReportTimeline {
  if (timeline.error) {
    return { note: timeline.error, events: [], entities: [] };
  }

  const events = (timeline.timeline ?? []).slice(0, limit).map(event => {
    if (event && typeof event === 'object') {
      const value = event as Record<string, unknown>;
      const subject = typeof value.subject === 'string' ? value.subject : undefined;
      const object = typeof value.object === 'string' ? value.object : undefined;
      const label = [value.valid_from, value.subject, value.predicate, value.object].filter(Boolean).join(' · ') || 'Timeline event';
      return { label, detail: JSON.stringify(value), subject, object };
    }
    return { label: 'Timeline event', detail: String(event) };
  });

  const entities = Array.from(new Set(events.flatMap(event => [event.subject, event.object]).filter((value): value is string => Boolean(value)))).sort();
  const total = timeline.count ?? events.length;
  const note = `${total} timeline event(s) across all entities${total > limit ? `; showing first ${limit}` : ''}`;
  return { note, events, entities, selectedEntity };
}
