// docs/control-plane.md Phase 3: Fleet view only, not the full Mission Control section list --
// the other proposed sections (workspace canvas, captain chat, tasks, activity feed, reviews,
// knowledge graph, approvals queue) each depend on a later phase (Captains, Execution Profiles,
// MCP Gateway) that doesn't exist yet. A local web page served by the Phase 2 service, not
// Electron -- see docs/control-plane.md's tech-stack reasoning. Self-contained: no CDN, no
// bundler, same "no new dependency" bias as ctxhub report's static HTML, just fetched live from
// this process's own JSON API instead of embedded once at generation time.
export function renderFleetViewHtml(): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>ctxhub Fleet</title>
<style>
  body{font-family:system-ui,sans-serif;margin:2rem;max-width:960px;color:#1a1a1a}
  h1{margin-bottom:.25rem}
  .subtitle{color:#666;margin-top:0}
  table{width:100%;border-collapse:collapse;margin-top:1rem}
  th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid #e2e2e2;vertical-align:top}
  th{color:#666;font-weight:600;font-size:.8rem;text-transform:uppercase}
  .path{color:#666;font-size:.85rem;font-family:ui-monospace,monospace}
  .badge{display:inline-block;font-size:.75rem;padding:.15rem .5rem;border-radius:999px;color:#fff}
  .badge.ok{background:#0f766e}
  .badge.warn{background:#d97706}
  .badge.error{background:#dc2626}
  .badge.missing{background:#6b7280}
  .badge.loading{background:#9ca3af}
  .checks{margin:.35rem 0 0;padding-left:1.1rem;font-size:.85rem;color:#444}
  .checks li.warn{color:#b45309}
  .checks li.error{color:#b91c1c}
  .empty{color:#666;margin-top:1.5rem}
  button{padding:.4rem .8rem;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;font:inherit}
  @media (prefers-color-scheme: dark) {
    body{background:#1a1a1a;color:#eee}
    th,td{border-color:#444}
    .path{color:#aaa}
    button{background:#2a2a2a;color:#eee;border-color:#555}
  }
</style>
</head>
<body>
<h1>ctxhub Fleet</h1>
<p class="subtitle">Registered workspaces (<code>ctxhub workspace register</code>) and their <code>ctxhub doctor</code> health.</p>
<button id="refresh">Refresh</button>
<div id="root"></div>
<script>
async function loadFleet() {
  const root = document.getElementById('root');
  root.textContent = 'Loading...';

  const res = await fetch('/workspaces');
  const data = await res.json();
  const workspaces = data.workspaces || [];

  if (!workspaces.length) {
    root.innerHTML = '<p class="empty">No workspaces registered. Run: ctxhub workspace register</p>';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Name</th><th>Path</th><th>Status</th></tr></thead>';
  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  root.innerHTML = '';
  root.appendChild(table);

  for (const workspace of workspaces) {
    const row = document.createElement('tr');
    const statusCellId = 'status-' + workspace.name;
    row.innerHTML =
      '<td>' + escapeHtml(workspace.name) + '</td>' +
      '<td class="path">' + escapeHtml(workspace.path) + '</td>' +
      '<td id="' + statusCellId + '"><span class="badge loading">checking</span></td>';
    tbody.appendChild(row);

    if (!workspace.exists) {
      document.getElementById(statusCellId).innerHTML = '<span class="badge missing">path missing</span>';
      continue;
    }

    fetchStatus(workspace.name, statusCellId);
  }
}

async function fetchStatus(name, cellId) {
  const cell = document.getElementById(cellId);
  try {
    const res = await fetch('/workspaces/' + encodeURIComponent(name) + '/status');
    if (!res.ok) {
      cell.innerHTML = '<span class="badge error">unavailable</span>';
      return;
    }
    const data = await res.json();
    const checks = data.checks || [];
    const worst = checks.some(c => c.status === 'error') ? 'error'
      : checks.some(c => c.status === 'warn') ? 'warn' : 'ok';

    let html = '<span class="badge ' + worst + '">' + worst + '</span>';
    const notable = checks.filter(c => c.status !== 'ok');
    if (notable.length) {
      html += '<ul class="checks">' + notable.map(c => '<li class="' + c.status + '">' + escapeHtml(c.message) + '</li>').join('') + '</ul>';
    }
    cell.innerHTML = html;
  } catch {
    cell.innerHTML = '<span class="badge error">unavailable</span>';
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

document.getElementById('refresh').addEventListener('click', loadFleet);
loadFleet();
</script>
</body>
</html>
`;
}
