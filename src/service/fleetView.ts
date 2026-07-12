// docs/control-plane.md Phase 3: Mission Control — full next-generation dashboard replacing the
// original minimal table. Self-contained single HTML file: no CDN, no bundler, pure Canvas API
// for the force-directed graph, inline CSS/JS — same "no new dependency" constraint as ctxhub
// report. Data comes from the Phase 2 service API in real-time rather than being embedded at
// generation time. The chat panel calls POST /workspaces/:name/chat added in server.ts Phase 3.

export function renderFleetViewHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mission Control — ctxhub</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

:root{
  --bg-void:#06060f;
  --bg-base:#0d0d1a;
  --bg-surface:#13132a;
  --bg-elevated:#1a1a35;
  --bg-overlay:#212140;
  --bg-glass:rgba(18,18,38,0.82);

  --border-faint:rgba(140,130,255,0.06);
  --border-subtle:rgba(140,130,255,0.10);
  --border-default:rgba(140,130,255,0.16);
  --border-strong:rgba(140,130,255,0.28);

  --accent:#7c6ef5;
  --accent-dim:rgba(124,110,245,0.14);
  --accent-glow:rgba(124,110,245,0.35);
  --accent-hover:#9d93f8;

  --ok:#0fd97b;
  --ok-dim:rgba(15,217,123,0.10);
  --warn:#f5a623;
  --warn-dim:rgba(245,166,35,0.10);
  --error:#f03d3d;
  --error-dim:rgba(240,61,61,0.10);
  --muted:#525280;

  --text-1:#eeeeff;
  --text-2:#9898c0;
  --text-3:#5a5a80;
  --text-accent:#b0a8ff;

  --font:Inter,system-ui,-apple-system,sans-serif;
  --font-mono:'JetBrains Mono','Fira Code',ui-monospace,monospace;

  --r-sm:6px;--r:10px;--r-lg:14px;--r-xl:20px;

  --sidebar-w:218px;
  --chat-w:336px;
  --top-h:52px;
  --act-h:176px;

  --shadow-sm:0 1px 4px rgba(0,0,0,0.45);
  --shadow:0 4px 16px rgba(0,0,0,0.55);
  --shadow-lg:0 8px 32px rgba(0,0,0,0.65);
}

html,body{height:100%;overflow:hidden}
body{
  background:var(--bg-void);
  color:var(--text-1);
  font-family:var(--font);
  font-size:13px;
  line-height:1.5;
  display:grid;
  grid-template-columns:var(--sidebar-w) 1fr var(--chat-w);
  grid-template-rows:var(--top-h) 1fr var(--act-h);
  grid-template-areas:
    "top top top"
    "side main chat"
    "side act  chat";
}

/* scrollbars */
*{scrollbar-width:thin;scrollbar-color:var(--border-default) transparent}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border-default);border-radius:4px}

/* ── TOPBAR ──────────────────────────────────────────── */
#top{
  grid-area:top;
  display:flex;align-items:center;gap:0;
  padding:0 16px;
  background:var(--bg-surface);
  border-bottom:1px solid var(--border-subtle);
  z-index:100;
}
.top-logo{
  display:flex;align-items:center;gap:10px;
  width:var(--sidebar-w);padding-right:12px;flex-shrink:0;
}
.logo-mark{
  width:28px;height:28px;border-radius:7px;flex-shrink:0;
  background:linear-gradient(135deg,var(--accent) 0%,#4f46e5 100%);
  display:flex;align-items:center;justify-content:center;
  font-size:14px;font-weight:800;color:#fff;
  box-shadow:0 2px 10px var(--accent-glow);
  user-select:none;
}
.logo-text{font-size:14px;font-weight:700;letter-spacing:-0.3px}
.logo-sub{font-size:9px;color:var(--text-3);letter-spacing:1.5px;text-transform:uppercase}
.top-div{width:1px;height:24px;background:var(--border-subtle);margin:0 12px;flex-shrink:0}
.top-pills{display:flex;gap:6px;flex-wrap:nowrap}
.pill{
  display:flex;align-items:center;gap:5px;
  padding:3px 10px;border-radius:999px;
  font-size:11px;font-weight:600;border:1px solid;white-space:nowrap;
}
.pill-ok{background:var(--ok-dim);border-color:rgba(15,217,123,0.25);color:var(--ok)}
.pill-warn{background:var(--warn-dim);border-color:rgba(245,166,35,0.25);color:var(--warn)}
.pill-error{background:var(--error-dim);border-color:rgba(240,61,61,0.25);color:var(--error)}
.pill-n{background:rgba(82,82,128,0.12);border-color:var(--border-default);color:var(--text-2)}
.top-space{flex:1}
.top-actions{display:flex;gap:6px;align-items:center}
#clock{font-family:var(--font-mono);font-size:11px;color:var(--text-3);padding:0 6px;letter-spacing:0.5px}
.icon-btn{
  width:30px;height:30px;border-radius:var(--r-sm);
  border:1px solid var(--border-subtle);background:transparent;
  color:var(--text-2);cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  font-size:14px;transition:all 0.14s;
}
.icon-btn:hover{background:var(--bg-elevated);color:var(--text-1);border-color:var(--border-default)}

/* ── SIDEBAR ─────────────────────────────────────────── */
#side{
  grid-area:side;
  background:var(--bg-base);
  border-right:1px solid var(--border-subtle);
  display:flex;flex-direction:column;overflow:hidden;
}
.s-section{padding:12px 12px 4px}
.s-label{
  font-size:9px;font-weight:700;color:var(--text-3);
  letter-spacing:1.2px;text-transform:uppercase;
  padding:0 4px 6px;
}
.nav-item{
  display:flex;align-items:center;gap:9px;
  padding:7px 10px;border-radius:var(--r-sm);
  cursor:pointer;color:var(--text-2);
  transition:all 0.12s;position:relative;font-size:13px;
}
.nav-item:hover{background:var(--bg-surface);color:var(--text-1)}
.nav-item.active{background:var(--accent-dim);color:var(--text-accent)}
.nav-item.active::before{
  content:'';position:absolute;left:0;top:6px;bottom:6px;
  width:2.5px;background:var(--accent);border-radius:0 2px 2px 0;
}
.nav-icon{font-size:14px;width:18px;text-align:center;flex-shrink:0}
.s-div{height:1px;background:var(--border-faint);margin:8px 12px}
.ws-list{flex:1;overflow-y:auto;padding:0 12px 12px}
.ws-item{
  display:flex;align-items:center;gap:8px;
  padding:7px 10px;border-radius:var(--r);
  cursor:pointer;margin-bottom:3px;
  border:1px solid transparent;transition:all 0.12s;
}
.ws-item:hover{background:var(--bg-surface);border-color:var(--border-subtle)}
.ws-item.sel{background:var(--bg-elevated);border-color:var(--border-default)}
.ws-dot{
  width:8px;height:8px;border-radius:50%;flex-shrink:0;
  box-shadow:0 0 5px currentColor;
}
.ws-dot.ok{color:var(--ok);background:var(--ok)}
.ws-dot.warn{color:var(--warn);background:var(--warn)}
.ws-dot.error{color:var(--error);background:var(--error)}
.ws-dot.ld{color:var(--muted);background:var(--muted);animation:pulse 1.5s infinite}
.ws-name{font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ws-path{font-size:10px;color:var(--text-3);font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.side-foot{padding:12px;border-top:1px solid var(--border-faint)}
.ver{font-size:10px;color:var(--text-3);font-family:var(--font-mono)}

/* ── MAIN (canvas + overlays) ────────────────────────── */
#main{grid-area:main;position:relative;overflow:hidden;background:var(--bg-void)}
#graph-canvas{position:absolute;inset:0;width:100%;height:100%;cursor:grab}
#graph-canvas:active{cursor:grabbing}

/* graph toolbar */
#gtb{
  position:absolute;top:12px;left:50%;transform:translateX(-50%);
  display:flex;gap:4px;
  background:var(--bg-glass);backdrop-filter:blur(14px);
  border:1px solid var(--border-default);border-radius:var(--r-xl);
  padding:4px;z-index:10;box-shadow:var(--shadow);
}
.tbtn{
  padding:5px 12px;border-radius:99px;
  background:transparent;border:none;
  color:var(--text-2);font-size:11px;font-weight:600;
  cursor:pointer;transition:all 0.12s;
  display:flex;align-items:center;gap:5px;font-family:var(--font);
}
.tbtn:hover{background:var(--bg-overlay);color:var(--text-1)}
.tbtn.on{background:var(--accent-dim);color:var(--text-accent)}
.tb-sep{width:1px;background:var(--border-subtle);margin:4px 2px}

/* minimap */
#mmap{
  position:absolute;bottom:12px;right:12px;
  width:140px;height:88px;
  background:var(--bg-glass);backdrop-filter:blur(12px);
  border:1px solid var(--border-default);border-radius:var(--r);
  overflow:hidden;z-index:10;
}
#mmap canvas{width:100%;height:100%}

/* tooltip */
#tip{
  position:absolute;z-index:20;
  background:var(--bg-elevated);border:1px solid var(--border-default);
  border-radius:var(--r);padding:8px 12px;font-size:12px;
  box-shadow:var(--shadow);pointer-events:none;
  opacity:0;transition:opacity 0.14s;max-width:220px;
}
#tip.vis{opacity:1}

/* detail slide-in panel */
#det{
  position:absolute;top:0;right:0;bottom:0;width:276px;
  background:var(--bg-glass);backdrop-filter:blur(18px);
  border-left:1px solid var(--border-default);
  display:flex;flex-direction:column;
  transform:translateX(100%);
  transition:transform 0.22s cubic-bezier(0.4,0,0.2,1);
  z-index:15;overflow-y:auto;
}
#det.open{transform:translateX(0)}
.det-hd{
  padding:14px 14px 10px;
  border-bottom:1px solid var(--border-subtle);flex-shrink:0;position:relative;
}
.det-name{font-size:14px;font-weight:700}
.det-path{font-size:10px;color:var(--text-3);font-family:var(--font-mono);margin-top:2px;word-break:break-all}
.det-close{
  position:absolute;top:10px;right:10px;
  width:24px;height:24px;
  background:var(--bg-elevated);border:1px solid var(--border-subtle);
  border-radius:50%;cursor:pointer;color:var(--text-2);
  display:flex;align-items:center;justify-content:center;font-size:12px;
  transition:all 0.12s;
}
.det-close:hover{background:var(--bg-overlay);color:var(--text-1)}
.det-sec{padding:12px 14px;border-bottom:1px solid var(--border-faint)}
.det-lbl{font-size:9px;font-weight:700;color:var(--text-3);letter-spacing:1px;text-transform:uppercase;margin-bottom:8px}
.chk{display:flex;align-items:flex-start;gap:7px;padding:5px 0;font-size:11px;line-height:1.4}
.chk-ico{flex-shrink:0;font-size:12px;margin-top:1px}
.chk.ok .chk-ico{color:var(--ok)}.chk.ok .chk-msg{color:var(--text-3)}
.chk.warn .chk-ico{color:var(--warn)}
.chk.error .chk-ico{color:var(--error)}
.det-acts{display:flex;flex-direction:column;gap:6px;padding:12px 14px}
.act-btn{
  display:flex;align-items:center;gap:8px;
  padding:8px 12px;border-radius:var(--r);
  background:var(--bg-elevated);border:1px solid var(--border-default);
  color:var(--text-2);font-size:11px;font-weight:600;
  cursor:pointer;transition:all 0.12s;text-align:left;font-family:var(--font);
}
.act-btn:hover{background:var(--bg-overlay);color:var(--text-1);border-color:var(--border-strong)}
.act-btn.pri{background:var(--accent-dim);border-color:rgba(124,110,245,0.3);color:var(--text-accent)}
.act-btn.pri:hover{background:rgba(124,110,245,0.22)}

/* ── CHAT PANEL ──────────────────────────────────────── */
#chat{
  grid-area:chat;
  background:var(--bg-base);
  border-left:1px solid var(--border-subtle);
  display:flex;flex-direction:column;overflow:hidden;
}
.pnl-hd{
  display:flex;align-items:center;gap:8px;
  padding:12px 14px;
  border-bottom:1px solid var(--border-subtle);flex-shrink:0;
}
.pnl-title{font-size:12px;font-weight:700;flex:1}
.pnl-sub{font-size:10px;color:var(--text-3)}
.chat-msgs{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:10px}
.chat-empty{
  flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:10px;color:var(--text-3);padding:20px;
}
.chat-empty-ico{font-size:32px;opacity:0.35}
.chat-empty-txt{font-size:12px;text-align:center;line-height:1.7}
.msg{display:flex;flex-direction:column;gap:3px}
.msg-role{font-size:9px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text-3)}
.msg.usr .msg-role{color:var(--accent);text-align:right}
.msg-body{
  background:var(--bg-surface);border:1px solid var(--border-subtle);
  border-radius:var(--r);padding:9px 12px;
  font-size:12px;line-height:1.65;color:var(--text-1);
}
.msg.usr .msg-body{
  background:var(--accent-dim);border-color:rgba(124,110,245,0.2);text-align:right;
}
.msg-cite{
  font-size:10px;color:var(--accent);font-family:var(--font-mono);
  padding:4px 8px;background:var(--bg-elevated);
  border-radius:var(--r-sm);border-left:2px solid var(--accent);margin-top:4px;
}
.thinking{display:flex;gap:4px;align-items:center;padding:8px 2px}
.dot{
  width:6px;height:6px;border-radius:50%;background:var(--accent);opacity:0.35;
  animation:think 1.2s infinite;
}
.dot:nth-child(2){animation-delay:0.2s}
.dot:nth-child(3){animation-delay:0.4s}
.chat-foot{padding:12px;border-top:1px solid var(--border-subtle);flex-shrink:0}
.chat-sel{
  width:100%;margin-bottom:8px;
  background:var(--bg-elevated);border:1px solid var(--border-default);
  border-radius:var(--r-sm);color:var(--text-2);
  font-family:var(--font);font-size:11px;padding:5px 8px;
}
.chat-row{display:flex;gap:6px}
.chat-in{
  flex:1;background:var(--bg-elevated);border:1px solid var(--border-default);
  border-radius:var(--r);color:var(--text-1);font-family:var(--font);font-size:12px;
  padding:8px 12px;resize:none;outline:none;transition:border-color 0.14s;
}
.chat-in:focus{border-color:var(--accent)}
.chat-send{
  width:36px;height:36px;flex-shrink:0;
  background:var(--accent);border:none;border-radius:var(--r);
  color:#fff;font-size:16px;cursor:pointer;
  display:flex;align-items:center;justify-content:center;
  transition:all 0.12s;align-self:flex-end;
}
.chat-send:hover{background:var(--accent-hover);transform:scale(1.06)}
.chat-send:disabled{opacity:0.38;cursor:not-allowed;transform:none}

/* ── ACTIVITY ─────────────────────────────────────────── */
#act{
  grid-area:act;
  background:var(--bg-base);border-top:1px solid var(--border-subtle);
  display:flex;flex-direction:column;overflow:hidden;
}
.feed{flex:1;overflow-y:auto;padding:4px 14px 10px;display:flex;flex-direction:column;gap:1px}
.feed-item{
  display:flex;align-items:flex-start;gap:10px;
  padding:5px 8px;border-radius:var(--r-sm);transition:background 0.1s;
}
.feed-item:hover{background:var(--bg-surface)}
.feed-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;margin-top:4px}
.feed-dot.ok{background:var(--ok)}
.feed-dot.warn{background:var(--warn)}
.feed-dot.error{background:var(--error)}
.feed-dot.info{background:var(--accent)}
.feed-content{flex:1;min-width:0}
.feed-txt{font-size:11px;color:var(--text-2);line-height:1.4}
.feed-txt strong{color:var(--text-1);font-weight:600}
.feed-time{font-size:10px;color:var(--text-3);font-family:var(--font-mono);flex-shrink:0}

/* ── ANIMATIONS ──────────────────────────────────────── */
@keyframes pulse{0%,100%{opacity:0.35}50%{opacity:1}}
@keyframes think{0%,60%,100%{opacity:0.2;transform:scale(0.82)}30%{opacity:1;transform:scale(1)}}
@keyframes slidein{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:translateY(0)}}
.si{animation:slidein 0.18s ease}
</style>
</head>
<body>

<!-- ── TOPBAR ── -->
<header id="top">
  <div class="top-logo">
    <div class="logo-mark">&#x2B21;</div>
    <div>
      <div class="logo-text">ctxhub</div>
      <div class="logo-sub">Mission Control</div>
    </div>
  </div>
  <div class="top-div"></div>
  <div class="top-pills" id="fleet-pills"><div class="pill pill-n">Loading&hellip;</div></div>
  <div class="top-space"></div>
  <div class="top-actions">
    <div id="clock"></div>
    <div class="top-div"></div>
    <span id="sse-indicator" style="font-size:11px;font-weight:600;color:var(--warn);padding:0 6px;white-space:nowrap">&#9675; Offline</span>
    <div class="top-div"></div>
    <button class="icon-btn" title="Refresh" id="btn-refresh">&#8635;</button>
  </div>
</header>

<!-- ── SIDEBAR ── -->
<aside id="side">
  <div class="s-section">
    <div class="s-label">Navigation</div>
    <div class="nav-item active" id="nav-fleet" style="cursor:pointer">
      <span class="nav-icon">&#9672;</span> Fleet
    </div>
    <div class="nav-item" id="nav-groups" style="cursor:pointer">
      <span class="nav-icon">&#9678;</span> Groups
    </div>
    <div class="nav-item" id="nav-cloud" style="cursor:pointer">
      <span class="nav-icon">&#9729;</span> Cloud
    </div>
    <div class="nav-item" id="nav-group-intel" style="cursor:pointer">
      <span class="nav-icon">&#9768;</span> Group Intel
    </div>
    <div class="nav-item" style="opacity:0.45;cursor:default" title="Coming in Phase 4 — Captains">
      <span class="nav-icon">&#9670;</span> Captains
    </div>
    <div class="nav-item" style="opacity:0.45;cursor:default" title="Coming in Phase 5 — Knowledge">
      <span class="nav-icon">&#9673;</span> Knowledge
    </div>
  </div>
  <div class="s-div"></div>
  <div class="s-section"><div class="s-label">Workspaces</div></div>
  <div class="ws-list" id="ws-list"></div>
  <div class="side-foot"><div class="ver" id="ver">ctxhub</div></div>
</aside>

<!-- ── MAIN ── -->
<main id="main">
  <div id="gtb">
    <button class="tbtn on" id="btn-graph">&#9672; Graph</button>
    <div class="tb-sep"></div>
    <button class="tbtn" id="btn-fit">&#8869; Fit</button>
    <button class="tbtn" id="btn-zi">+</button>
    <button class="tbtn" id="btn-zo">&minus;</button>
    <div class="tb-sep"></div>
    <button class="tbtn" id="btn-freeze">&#10052; Freeze</button>
  </div>

  <canvas id="graph-canvas"></canvas>

  <div id="mmap"><canvas id="mmap-canvas"></canvas></div>
  <div id="tip"></div>

  <!-- detail slide-in -->
  <div id="det">
    <button class="det-close" id="det-close">&#10005;</button>
    <div class="det-hd">
      <div class="det-name" id="det-name">&mdash;</div>
      <div class="det-path" id="det-path"></div>
    </div>
    <div class="det-sec">
      <div class="det-lbl">Health</div>
      <div id="det-checks"></div>
    </div>
    <div class="det-acts">
      <button class="act-btn pri" id="det-chat-btn">&#9673; Ask this workspace</button>
      <button class="act-btn" id="det-refresh-btn">&#8635; Re-check health</button>
    </div>
  </div>

  <!-- groups panel -->
  <div id="groups-panel" style="display:none;position:absolute;inset:0;overflow-y:auto;padding:20px 24px;background:var(--bg-base)">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <span style="color:var(--text-accent);font-size:18px">&#9678;</span>
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--text-1)">Corporate Groups</div>
        <div style="font-size:11px;color:var(--text-3)">Cross-org knowledge sharing configuration</div>
      </div>
      <button class="tbtn" id="btn-groups-refresh" style="margin-left:auto">&#8635; Refresh</button>
    </div>
    <div id="groups-content">
      <div style="color:var(--text-3);font-size:12px;padding:8px 0">Loading&hellip;</div>
    </div>
  </div>

  <!-- group intel panel -->
  <div id="group-intel-panel" style="display:none;position:absolute;inset:0;overflow-y:auto;padding:20px 24px;background:var(--bg-base)">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <span style="color:var(--text-accent);font-size:18px">&#9768;</span>
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--text-1)">Group Intel</div>
        <div style="font-size:11px;color:var(--text-3)">Aggregated view across your corporate group</div>
      </div>
      <button class="tbtn" id="btn-group-intel-refresh" style="margin-left:auto">&#8635; Refresh</button>
    </div>
    <div id="group-intel-content">
      <div style="color:var(--text-3);font-size:12px;padding:8px 0">Loading&hellip;</div>
    </div>
  </div>

  <!-- cloud panel -->
  <div id="cloud-panel" style="display:none;position:absolute;inset:0;overflow-y:auto;padding:20px 24px;background:var(--bg-base)">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <span style="color:var(--text-accent);font-size:18px">&#9729;</span>
      <div>
        <div style="font-size:14px;font-weight:600;color:var(--text-1)">Cloud Sync</div>
        <div style="font-size:11px;color:var(--text-3)">Push promoted knowledge to ctxhub Cloud</div>
      </div>
      <button class="tbtn" id="btn-cloud-refresh" style="margin-left:auto">&#8635; Refresh</button>
    </div>
    <div id="cloud-content">
      <div style="color:var(--text-3);font-size:12px;padding:8px 0">Loading&hellip;</div>
    </div>
  </div>
</main>

<!-- ── ACTIVITY ── -->
<section id="act">
  <div class="pnl-hd">
    <span class="nav-icon" style="font-size:12px">&#9673;</span>
    <div class="pnl-title">Activity</div>
    <div class="pnl-sub">Live</div>
  </div>
  <div class="feed" id="feed">
    <div class="feed-item">
      <div class="feed-dot info"></div>
      <div class="feed-content"><div class="feed-txt">Mission Control started</div></div>
      <div class="feed-time" id="start-time"></div>
    </div>
  </div>
</section>

<!-- ── CHAT ── -->
<section id="chat">
  <div class="pnl-hd">
    <span class="nav-icon" style="font-size:12px">&#9670;</span>
    <div>
      <div class="pnl-title">Captain Chat</div>
      <div class="pnl-sub" id="chat-sub">Select a workspace</div>
    </div>
  </div>
  <div class="chat-msgs" id="chat-msgs">
    <div class="chat-empty" id="chat-empty">
      <div class="chat-empty-ico">&#9672;</div>
      <div class="chat-empty-txt">Select a workspace in the graph,<br>then ask it anything.</div>
    </div>
  </div>
  <div class="chat-foot">
    <select class="chat-sel" id="chat-ws-sel">
      <option value="">&mdash; Select workspace &mdash;</option>
    </select>
    <div class="chat-row">
      <textarea class="chat-in" id="chat-in" rows="2" placeholder="Ask your workspace&hellip;" disabled></textarea>
      <button class="chat-send" id="chat-send" disabled title="Send">&#9654;</button>
    </div>
  </div>
</section>

<script>
// =============================================================
// ctxhub Mission Control  —  client runtime
// =============================================================

// ── Utilities ──────────────────────────────────────────────
function esc(s){
  return String(s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function now12(){
  return new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
}
function now6(){
  return new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'});
}

// ── Clock ──────────────────────────────────────────────────
document.getElementById('start-time').textContent = now12();
(function tick(){
  document.getElementById('clock').textContent = now6();
  setTimeout(tick, 1000);
})();

// ── Activity feed ──────────────────────────────────────────
function addActivity(html, type){
  type = type || 'info';
  var feed = document.getElementById('feed');
  var el = document.createElement('div');
  el.className = 'feed-item si';
  el.innerHTML =
    '<div class="feed-dot ' + type + '"></div>' +
    '<div class="feed-content"><div class="feed-txt">' + html + '</div></div>' +
    '<div class="feed-time">' + now12() + '</div>';
  feed.insertBefore(el, feed.firstChild);
  while(feed.children.length > 48) feed.removeChild(feed.lastChild);
}

// ── Force-directed graph ───────────────────────────────────
function ForceGraph(canvas){
  this.canvas = canvas;
  this.ctx = canvas.getContext('2d');
  this.nodes = [];
  this.edges = [];
  this.selected = null;
  this.hovered  = null;
  this.dragging = null;
  this.frozen   = false;
  this.alpha    = 1;
  this.frame    = 0;
  this.tx = 0; this.ty = 0; this.scale = 1;
  this._panning = false; this._panStart = {x:0,y:0}; this._panOrig = {x:0,y:0};
  this._bindEvents();
  this._resize();
  window.addEventListener('resize', this._resize.bind(this));
}

ForceGraph.prototype._resize = function(){
  var r = this.canvas.parentElement.getBoundingClientRect();
  this.canvas.width  = r.width;
  this.canvas.height = r.height;
};

ForceGraph.prototype.healthColor = function(h){
  if(h==='ok')   return '#0fd97b';
  if(h==='warn') return '#f5a623';
  if(h==='error')return '#f03d3d';
  return '#525280';
};

ForceGraph.prototype.addNode = function(id, label, type, health, meta){
  var existing = null;
  for(var i=0;i<this.nodes.length;i++){ if(this.nodes[i].id===id){existing=this.nodes[i];break;} }
  if(existing){ existing.health=health; if(meta) existing.meta=meta; return; }
  var wsCount = 0;
  for(var i=0;i<this.nodes.length;i++){ if(this.nodes[i].type===type) wsCount++; }
  var angle = (wsCount / Math.max(6, this.nodes.length+1)) * Math.PI * 2;
  var dist  = type==='workspace' ? 180 : 0;
  this.nodes.push({
    id:id, label:label, type:type, health:health, meta:meta||{},
    r: type==='workspace' ? 44 : 20,
    x: this.canvas.width/2  + Math.cos(angle)*dist + (Math.random()-0.5)*50,
    y: this.canvas.height/2 + Math.sin(angle)*dist + (Math.random()-0.5)*50,
    vx:0, vy:0, pinned:false
  });
};

ForceGraph.prototype.addEdge = function(src, tgt, type){
  for(var i=0;i<this.edges.length;i++){
    if(this.edges[i].src===src && this.edges[i].tgt===tgt) return;
  }
  this.edges.push({src:src, tgt:tgt, type:type||'link'});
};

ForceGraph.prototype.setHealth = function(id, health){
  for(var i=0;i<this.nodes.length;i++){
    if(this.nodes[i].id===id){ this.nodes[i].health=health; break; }
  }
};

ForceGraph.prototype.nodeById = function(id){
  for(var i=0;i<this.nodes.length;i++) if(this.nodes[i].id===id) return this.nodes[i];
  return null;
};

ForceGraph.prototype._toWorld = function(cx,cy){
  return {x:(cx-this.tx)/this.scale, y:(cy-this.ty)/this.scale};
};

ForceGraph.prototype._nodeAt = function(cx,cy){
  var w = this._toWorld(cx,cy);
  for(var i=this.nodes.length-1;i>=0;i--){
    var n=this.nodes[i];
    if(Math.hypot(n.x-w.x, n.y-w.y) < n.r+4) return n;
  }
  return null;
};

ForceGraph.prototype.tick = function(){
  if(this.frozen || this.alpha < 0.004) return;
  var alpha=this.alpha, rep=7200, sLen=140, sK=0.038, damp=0.74;
  var nodes=this.nodes, edges=this.edges;
  for(var i=0;i<nodes.length;i++){
    for(var j=i+1;j<nodes.length;j++){
      var a=nodes[i],b=nodes[j];
      var dx=b.x-a.x, dy=b.y-a.y;
      var d2=dx*dx+dy*dy||0.001, d=Math.sqrt(d2);
      var f=rep/d2, fx=(dx/d)*f*alpha, fy=(dy/d)*f*alpha;
      if(!a.pinned){a.vx-=fx;a.vy-=fy;}
      if(!b.pinned){b.vx+=fx;b.vy+=fy;}
    }
  }
  for(var e=0;e<edges.length;e++){
    var edge=edges[e];
    var a=this.nodeById(edge.src), b=this.nodeById(edge.tgt);
    if(!a||!b) continue;
    var dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;
    var f=(d-sLen)*sK*alpha,fx=(dx/d)*f,fy=(dy/d)*f;
    if(!a.pinned){a.vx+=fx;a.vy+=fy;}
    if(!b.pinned){b.vx-=fx;b.vy-=fy;}
  }
  var cx=this.canvas.width/2, cy=this.canvas.height/2;
  for(var i=0;i<nodes.length;i++){
    var n=nodes[i]; if(n.pinned) continue;
    n.vx+=(cx-n.x)*0.002*alpha;
    n.vy+=(cy-n.y)*0.002*alpha;
    n.vx*=damp; n.vy*=damp;
    n.x+=n.vx;  n.y+=n.vy;
  }
  this.alpha*=0.996;
};

ForceGraph.prototype.draw = function(){
  var ctx=this.ctx, W=this.canvas.width, H=this.canvas.height;
  ctx.clearRect(0,0,W,H);

  // grid dots
  var gs=44*Math.min(this.scale,1.2);
  var ox=((this.tx%gs)+gs)%gs, oy=((this.ty%gs)+gs)%gs;
  ctx.fillStyle='rgba(80,80,140,0.16)';
  for(var x=ox;x<W;x+=gs) for(var y=oy;y<H;y+=gs){
    ctx.beginPath(); ctx.arc(x,y,0.9,0,Math.PI*2); ctx.fill();
  }

  ctx.save();
  ctx.translate(this.tx, this.ty);
  ctx.scale(this.scale, this.scale);

  // edges
  for(var e=0;e<this.edges.length;e++){
    var edge=this.edges[e];
    var a=this.nodeById(edge.src), b=this.nodeById(edge.tgt);
    if(!a||!b) continue;
    var isSel = (a.id===this.selected||b.id===this.selected);
    ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y);
    ctx.strokeStyle = isSel ? 'rgba(124,110,245,0.38)' : 'rgba(80,80,160,0.15)';
    ctx.lineWidth   = isSel ? 1.5 : 1;
    ctx.stroke();
    // travel particle on selected edge
    if(isSel && !this.frozen){
      var t=(this.frame*0.013)%1;
      var px=a.x+(b.x-a.x)*t, py=a.y+(b.y-a.y)*t;
      ctx.beginPath(); ctx.arc(px,py,2.5,0,Math.PI*2);
      ctx.fillStyle='#7c6ef5'; ctx.fill();
    }
  }

  // nodes
  for(var i=0;i<this.nodes.length;i++){
    var n=this.nodes[i];
    var isSel=(n.id===this.selected), isHov=(n.id===this.hovered);
    var hc=this.healthColor(n.health);

    // outer glow
    if(isSel||isHov){
      var g=ctx.createRadialGradient(n.x,n.y,n.r,n.x,n.y,n.r+26);
      g.addColorStop(0, isSel ? 'rgba(124,110,245,0.32)' : 'rgba(124,110,245,0.14)');
      g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.beginPath(); ctx.arc(n.x,n.y,n.r+26,0,Math.PI*2);
      ctx.fillStyle=g; ctx.fill();
    }

    // health ring glow
    var hg=ctx.createRadialGradient(n.x,n.y,n.r-3,n.x,n.y,n.r+10);
    hg.addColorStop(0, hc+'44');
    hg.addColorStop(1,'rgba(0,0,0,0)');
    ctx.beginPath(); ctx.arc(n.x,n.y,n.r+10,0,Math.PI*2);
    ctx.fillStyle=hg; ctx.fill();

    // node body
    var bg=ctx.createRadialGradient(n.x-n.r*0.3,n.y-n.r*0.4,0,n.x,n.y,n.r*1.2);
    if(n.type==='workspace'){
      bg.addColorStop(0,'#1d1d42'); bg.addColorStop(1,'#0c0c22');
    } else {
      bg.addColorStop(0,'#15152e'); bg.addColorStop(1,'#09091a');
    }
    ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2);
    ctx.fillStyle=bg; ctx.fill();

    // health ring
    ctx.beginPath(); ctx.arc(n.x,n.y,n.r,0,Math.PI*2);
    ctx.strokeStyle=hc;
    ctx.lineWidth = isSel ? 2.5 : isHov ? 2 : 1.5;
    ctx.stroke();

    // inner accent ring (workspace only)
    if(n.type==='workspace'){
      ctx.beginPath(); ctx.arc(n.x,n.y,n.r-7,0,Math.PI*2);
      ctx.strokeStyle='rgba(124,110,245,0.18)'; ctx.lineWidth=1; ctx.stroke();
    }

    // label
    ctx.textAlign='center'; ctx.textBaseline='middle';
    ctx.font = n.type==='workspace' ? 'bold 11px system-ui' : '9px system-ui';
    ctx.fillStyle = n.type==='workspace' ? '#eeeeff' : '#8888bb';
    var lbl = n.label.length>14 ? n.label.slice(0,13)+'…' : n.label;
    ctx.fillText(lbl, n.x, n.y);
  }

  ctx.restore();
  this.frame++;
};

ForceGraph.prototype.fit = function(){
  if(!this.nodes.length) return;
  var xs=this.nodes.map(function(n){return n.x;}),
      ys=this.nodes.map(function(n){return n.y;});
  var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs);
  var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys);
  var pad=80;
  var sx=(this.canvas.width-pad*2)/((maxX-minX)||1);
  var sy=(this.canvas.height-pad*2)/((maxY-minY)||1);
  this.scale=Math.min(sx,sy,2.2);
  this.tx=pad-minX*this.scale+((this.canvas.width-pad*2)-(maxX-minX)*this.scale)/2;
  this.ty=pad-minY*this.scale+((this.canvas.height-pad*2)-(maxY-minY)*this.scale)/2;
};

ForceGraph.prototype.start = function(){
  var self=this;
  (function loop(){
    self.tick(); self.draw();
    requestAnimationFrame(loop);
  })();
};

ForceGraph.prototype._bindEvents = function(){
  var self=this, c=this.canvas;

  c.addEventListener('mousedown', function(e){
    var n=self._nodeAt(e.offsetX,e.offsetY);
    if(n){
      self.dragging=n; n.pinned=true;
      self.alpha=Math.max(self.alpha,0.3);
    } else {
      self._panning=true;
      self._panStart={x:e.clientX,y:e.clientY};
      self._panOrig={x:self.tx,y:self.ty};
    }
  });

  c.addEventListener('mousemove', function(e){
    if(self.dragging){
      var w=self._toWorld(e.offsetX,e.offsetY);
      self.dragging.x=w.x; self.dragging.y=w.y;
      self.dragging.vx=0;  self.dragging.vy=0;
      self.alpha=Math.max(self.alpha,0.08);
    } else if(self._panning){
      self.tx=self._panOrig.x+e.clientX-self._panStart.x;
      self.ty=self._panOrig.y+e.clientY-self._panStart.y;
    } else {
      var n=self._nodeAt(e.offsetX,e.offsetY);
      var prev=self.hovered;
      self.hovered=n?n.id:null;
      if(self.hovered!==prev) self.alpha=Math.max(self.alpha,0.04);
      var tip=document.getElementById('tip');
      if(n){
        var hl={ok:'OK',warn:'Warning',error:'Error',ld:'Checking'}[n.health]||n.health;
        tip.innerHTML='<strong>'+esc(n.label)+'</strong>'
          +'<br><span style="color:var(--text-3);font-size:10px">'+esc(n.type)+' &middot; '+hl+'</span>'
          +(n.meta&&n.meta.path?'<br><span style="font-family:monospace;font-size:10px;color:var(--text-3)">'+esc(n.meta.path)+'</span>':'');
        tip.style.left=(e.offsetX+14)+'px';
        tip.style.top =(e.offsetY-8)+'px';
        tip.classList.add('vis');
      } else {
        tip.classList.remove('vis');
      }
    }
  });

  c.addEventListener('mouseup', function(){
    if(self.dragging){ self.dragging.pinned=false; self.dragging=null; }
    self._panning=false;
  });

  c.addEventListener('mouseleave', function(){
    self.dragging=null; self._panning=false;
    document.getElementById('tip').classList.remove('vis');
  });

  c.addEventListener('click', function(e){
    var n=self._nodeAt(e.offsetX,e.offsetY);
    if(n){
      var wasSelected=(self.selected===n.id);
      self.selected = wasSelected ? null : n.id;
      onNodeSelect(wasSelected ? null : n);
      self.alpha=Math.max(self.alpha,0.18);
    } else if(!self._panning){
      self.selected=null; onNodeSelect(null);
    }
  });

  c.addEventListener('wheel', function(e){
    e.preventDefault();
    var f=e.deltaY>0?0.9:1.1;
    var rect=c.getBoundingClientRect();
    var mx=e.clientX-rect.left, my=e.clientY-rect.top;
    self.tx=mx-(mx-self.tx)*f;
    self.ty=my-(my-self.ty)*f;
    self.scale=Math.max(0.18,Math.min(4,self.scale*f));
  },{passive:false});
};

// ── Minimap ─────────────────────────────────────────────────
function drawMinimap(graph, mc){
  var ctx=mc.getContext('2d'), W=mc.width, H=mc.height;
  ctx.clearRect(0,0,W,H);
  if(!graph.nodes.length) return;
  var xs=graph.nodes.map(function(n){return n.x;}),
      ys=graph.nodes.map(function(n){return n.y;});
  var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs);
  var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys);
  var sc=Math.min((W-16)/((maxX-minX)||1),(H-16)/((maxY-minY)||1))*0.88;
  var ox=8, oy=8;
  for(var e=0;e<graph.edges.length;e++){
    var edge=graph.edges[e];
    var a=graph.nodeById(edge.src), b=graph.nodeById(edge.tgt);
    if(!a||!b) continue;
    ctx.beginPath();
    ctx.moveTo((a.x-minX)*sc+ox,(a.y-minY)*sc+oy);
    ctx.lineTo((b.x-minX)*sc+ox,(b.y-minY)*sc+oy);
    ctx.strokeStyle='rgba(80,80,180,0.38)'; ctx.lineWidth=0.5; ctx.stroke();
  }
  for(var i=0;i<graph.nodes.length;i++){
    var n=graph.nodes[i];
    ctx.beginPath();
    ctx.arc((n.x-minX)*sc+ox,(n.y-minY)*sc+oy,n.type==='workspace'?5:2.5,0,Math.PI*2);
    ctx.fillStyle=n.id===graph.selected?'#7c6ef5':graph.healthColor(n.health);
    ctx.fill();
  }
}

// ── State ────────────────────────────────────────────────────
var state={workspaces:[],selected:null,chatWs:null,chatBusy:false};

// ── Graph & minimap init ─────────────────────────────────────
var graph=new ForceGraph(document.getElementById('graph-canvas'));
graph.start();
var mc=document.getElementById('mmap-canvas'); mc.width=140; mc.height=88;
setInterval(function(){ drawMinimap(graph,mc); },600);

// ── Node selection ───────────────────────────────────────────
function onNodeSelect(node){
  state.selected=node?node.id:null;
  var det=document.getElementById('det');
  if(!node||node.type!=='workspace'){
    if(!node) det.classList.remove('open');
    return;
  }
  det.classList.add('open');
  document.getElementById('det-name').textContent=node.label;
  document.getElementById('det-path').textContent=(node.meta&&node.meta.path)||'';
  document.getElementById('det-checks').innerHTML='<div style="color:var(--text-3);font-size:11px;padding:4px 0">Checking health&hellip;</div>';

  // pre-select in chat
  var sel=document.getElementById('chat-ws-sel');
  sel.value=node.label;
  onChatWsChange(node.label);
  fetchWsStatus(node.label);
}

// ── Data loading ─────────────────────────────────────────────
function loadFleet(){
  fetch('/health').then(function(r){return r.json();}).then(function(h){
    document.getElementById('ver').textContent='ctxhub v'+(h.version||'?');
  }).catch(function(){});

  fetch('/workspaces').then(function(r){return r.json();}).then(function(data){
    state.workspaces=data.workspaces||[];
    rebuildSidebar();
    rebuildGraphNodes();
    rebuildChatSelect();
    updateFleetPills();
    state.workspaces.forEach(function(ws){ fetchWsStatus(ws.name); });
    addActivity('Fleet loaded: <strong>'+state.workspaces.length+'</strong> workspace'+(state.workspaces.length!==1?'s':''));
  }).catch(function(){
    document.getElementById('fleet-pills').innerHTML='<div class="pill pill-n">Service unavailable</div>';
    addActivity('Could not reach ctxhub service','error');
  });
}

function rebuildSidebar(){
  var list=document.getElementById('ws-list');
  list.innerHTML='';
  if(!state.workspaces.length){
    list.innerHTML='<div style="color:var(--text-3);font-size:11px;padding:8px 10px;line-height:1.6">No workspaces registered.<br>Run: <code style="font-family:monospace">ctxhub workspace register</code></div>';
    return;
  }
  state.workspaces.forEach(function(ws){
    var el=document.createElement('div');
    el.className='ws-item'+(state.selected===ws.name?' sel':'');
    el.dataset.name=ws.name;
    el.innerHTML=
      '<div class="ws-dot ld" id="wsdot-'+esc(ws.name)+'"></div>'+
      '<div><div class="ws-name">'+esc(ws.name)+'</div>'+
      '<div class="ws-path">'+esc((ws.path||'').split('/').slice(-2).join('/'))+'</div></div>';
    el.addEventListener('click',function(){
      var n=graph.nodeById(ws.name);
      if(n){
        graph.selected=ws.name;
        onNodeSelect(n);
        // pan to node
        graph.tx=graph.canvas.width/2-n.x*graph.scale;
        graph.ty=graph.canvas.height/2-n.y*graph.scale;
        graph.alpha=Math.max(graph.alpha,0.25);
      }
    });
    list.appendChild(el);
  });
}

function rebuildGraphNodes(){
  state.workspaces.forEach(function(ws){
    graph.addNode(ws.name, ws.name, 'workspace', ws.exists===false?'error':'ld', {path:ws.path});
  });
  setTimeout(function(){ graph.fit(); },700);
}

function rebuildChatSelect(){
  var sel=document.getElementById('chat-ws-sel');
  sel.innerHTML='<option value="">&mdash; Select workspace &mdash;</option>';
  state.workspaces.forEach(function(ws){
    var opt=document.createElement('option');
    opt.value=ws.name; opt.textContent=ws.name;
    sel.appendChild(opt);
  });
}

function updateFleetPills(){
  var counts={ok:0,warn:0,error:0,ld:0};
  graph.nodes.forEach(function(n){
    if(n.type==='workspace') counts[n.health]=(counts[n.health]||0)+1;
  });
  var pills='';
  if(counts.ok)   pills+='<div class="pill pill-ok">&#10003; '+counts.ok+' healthy</div>';
  if(counts.warn) pills+='<div class="pill pill-warn">&#9888; '+counts.warn+' warn</div>';
  if(counts.error)pills+='<div class="pill pill-error">&#10005; '+counts.error+' error</div>';
  if(counts.ld)   pills+='<div class="pill pill-n">&middot; '+counts.ld+'</div>';
  if(!pills)      pills='<div class="pill pill-n">No workspaces</div>';
  document.getElementById('fleet-pills').innerHTML=pills;
}

function fetchWsStatus(name){
  fetch('/workspaces/'+encodeURIComponent(name)+'/status').then(function(r){
    if(!r.ok) throw new Error('not ok');
    return r.json();
  }).then(function(data){
    var checks=data.checks||[];
    var health=checks.some(function(c){return c.status==='error';})?'error'
      :checks.some(function(c){return c.status==='warn';})?'warn':'ok';
    graph.setHealth(name,health);
    graph.alpha=Math.max(graph.alpha,0.08);
    var dot=document.getElementById('wsdot-'+name);
    if(dot) dot.className='ws-dot '+health;
    updateFleetPills();
    if(state.selected===name) renderChecks(checks);
    if(health!=='ok'){
      var issues=checks.filter(function(c){return c.status!=='ok';}).length;
      addActivity('<strong>'+esc(name)+'</strong>: '+issues+' issue'+(issues!==1?'s':''), health);
    }
  }).catch(function(){
    graph.setHealth(name,'error');
    var dot=document.getElementById('wsdot-'+name);
    if(dot) dot.className='ws-dot error';
    updateFleetPills();
  });
}

function renderChecks(checks){
  var el=document.getElementById('det-checks');
  if(!checks.length){el.innerHTML='<div style="color:var(--text-3);font-size:11px">No checks run</div>';return;}
  var icons={ok:'&#10003;',warn:'&#9888;',error:'&#10005;'};
  el.innerHTML=checks.map(function(c){
    return '<div class="chk '+c.status+'"><span class="chk-ico">'+(icons[c.status]||'&middot;')+'</span><span class="chk-msg">'+esc(c.message)+'</span></div>';
  }).join('');
}

// ── Chat ─────────────────────────────────────────────────────
function onChatWsChange(name){
  state.chatWs=name||null;
  var sub=document.getElementById('chat-sub');
  var inp=document.getElementById('chat-in');
  var btn=document.getElementById('chat-send');
  if(name){
    sub.textContent=name;
    inp.disabled=false; btn.disabled=false;
    inp.placeholder='Ask '+name+' anything…';
    document.getElementById('chat-empty').style.display='none';
  } else {
    sub.textContent='Select a workspace';
    inp.disabled=true; btn.disabled=true;
    inp.placeholder='Ask your workspace…';
  }
}

document.getElementById('chat-ws-sel').addEventListener('change',function(e){
  onChatWsChange(e.target.value);
});

function sendChat(){
  var query=(document.getElementById('chat-in').value||'').trim();
  if(!query||!state.chatWs||state.chatBusy) return;
  state.chatBusy=true;
  document.getElementById('chat-send').disabled=true;
  document.getElementById('chat-in').value='';

  var msgs=document.getElementById('chat-msgs');
  document.getElementById('chat-empty').style.display='none';

  // user bubble
  var uEl=document.createElement('div');
  uEl.className='msg usr si';
  uEl.innerHTML='<div class="msg-role">You</div><div class="msg-body">'+esc(query)+'</div>';
  msgs.appendChild(uEl);

  // thinking indicator
  var tEl=document.createElement('div');
  tEl.className='msg si';
  tEl.innerHTML='<div class="msg-role">Captain</div><div class="msg-body"><div class="thinking"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>';
  msgs.appendChild(tEl);
  msgs.scrollTop=msgs.scrollHeight;

  var wsName=state.chatWs;
  fetch('/workspaces/'+encodeURIComponent(wsName)+'/chat',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({query:query})
  }).then(function(r){
    if(!r.ok) return r.json().then(function(d){throw new Error(d.error||'Request failed');});
    return r.json();
  }).then(function(data){
    tEl.remove();
    var answer=Array.isArray(data.answer)?data.answer.join('\\n\\n'):data.answer||'';
    if(!answer && data.llmNotice) answer='(LLM synthesis skipped: '+data.llmNotice+')';
    if(!answer) answer='No synthesised answer &mdash; evidence retrieved (LLM may be disabled).';
    var citations=(data.citations||[]).slice(0,5).map(function(c){
      return '<div class="msg-cite">&#8599; '+esc(c.repo+': '+c.path)+'</div>';
    }).join('');
    var bEl=document.createElement('div');
    bEl.className='msg si';
    bEl.innerHTML='<div class="msg-role">Captain &middot; '+esc(wsName)+'</div><div class="msg-body">'+esc(answer)+'</div>'+citations;
    msgs.appendChild(bEl);
    addActivity('<strong>'+esc(wsName)+'</strong>: query answered','ok');
  }).catch(function(err){
    tEl.remove();
    var eEl=document.createElement('div');
    eEl.className='msg si';
    eEl.innerHTML='<div class="msg-role">System</div><div class="msg-body" style="color:var(--error)">'+esc(String(err))+'</div>';
    msgs.appendChild(eEl);
  }).finally(function(){
    msgs.scrollTop=msgs.scrollHeight;
    state.chatBusy=false;
    document.getElementById('chat-send').disabled=false;
    document.getElementById('chat-in').focus();
  });
}

document.getElementById('chat-send').addEventListener('click', sendChat);
document.getElementById('chat-in').addEventListener('keydown',function(e){
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendChat();}
});

// ── Toolbar buttons ──────────────────────────────────────────
document.getElementById('btn-refresh').addEventListener('click',function(){
  loadFleet(); addActivity('Fleet refreshed');
});
document.getElementById('btn-fit').addEventListener('click',function(){ graph.fit(); });
document.getElementById('btn-zi').addEventListener('click',function(){
  graph.scale=Math.min(4,graph.scale*1.3); graph.alpha=Math.max(graph.alpha,0.06);
});
document.getElementById('btn-zo').addEventListener('click',function(){
  graph.scale=Math.max(0.18,graph.scale/1.3); graph.alpha=Math.max(graph.alpha,0.06);
});
document.getElementById('btn-freeze').addEventListener('click',function(){
  graph.frozen=!graph.frozen;
  this.classList.toggle('on',graph.frozen);
  this.textContent=graph.frozen?'▶ Resume':'❄ Freeze';
});

// ── Detail panel buttons ─────────────────────────────────────
document.getElementById('det-close').addEventListener('click',function(){
  document.getElementById('det').classList.remove('open');
  graph.selected=null; state.selected=null;
});
document.getElementById('det-chat-btn').addEventListener('click',function(){
  if(state.selected){
    document.getElementById('chat-ws-sel').value=state.selected;
    onChatWsChange(state.selected);
    document.getElementById('chat-in').focus();
  }
});
document.getElementById('det-refresh-btn').addEventListener('click',function(){
  if(state.selected) fetchWsStatus(state.selected);
});

// ── Groups / Cloud / Group Intel panels ──────────────────────────────
var GRAPH_ELEMENTS = ['gtb','graph-canvas','mmap'];
var ALL_PANELS = ['groups-panel','cloud-panel','group-intel-panel'];

function showView(view){
  var isFleet = (view === 'fleet');
  GRAPH_ELEMENTS.forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.style.display = isFleet ? '' : 'none';
  });
  ALL_PANELS.forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.style.display = 'none';
  });
  if(!isFleet){
    var panelId = view + '-panel';
    var panelEl = document.getElementById(panelId);
    if(panelEl) panelEl.style.display = '';
  }
  document.getElementById('nav-fleet').classList.toggle('active', isFleet);
  document.getElementById('nav-groups').classList.toggle('active', view === 'groups');
  document.getElementById('nav-cloud').classList.toggle('active', view === 'cloud');
  document.getElementById('nav-group-intel').classList.toggle('active', view === 'group-intel');
  if(view === 'groups') loadGroups();
  if(view === 'cloud') loadCloud();
  if(view === 'group-intel') loadGroupIntel();
}

function loadGroups(){
  document.getElementById('groups-content').innerHTML =
    '<div style="color:var(--text-3);font-size:12px;padding:8px 0">Loading&hellip;</div>';
  fetch('/groups').then(function(r){ return r.json(); }).then(function(data){
    renderGroups(data);
  }).catch(function(err){
    document.getElementById('groups-content').innerHTML =
      '<div style="color:var(--error);font-size:12px">' + esc(String(err)) + '</div>';
  });
}

function renderGroups(data){
  var groups  = data.groups  || [];
  var orgs    = data.orgs    || [];
  var policies = data.sharingPolicies || [];
  var el = document.getElementById('groups-content');

  if(!groups.length){
    el.innerHTML =
      '<div style="color:var(--text-3);font-size:12px;padding:12px 0;line-height:1.8">' +
      'No corporate groups configured.<br>' +
      'Run: <code style="font-family:var(--font-mono)">ctxhub group create &lt;name&gt;</code>' +
      '</div>';
    return;
  }

  el.innerHTML = '';
  groups.forEach(function(g){
    var groupOrgs = orgs.filter(function(o){ return o.groupId === g.id; });

    var card = document.createElement('div');
    card.style.cssText =
      'background:var(--bg-surface);border:1px solid var(--border-subtle);' +
      'border-radius:var(--r-lg);padding:18px 20px;margin-bottom:16px';

    // Header
    var header =
      '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
        '<span style="color:var(--text-accent);font-size:16px">&#9678;</span>' +
        '<div style="font-size:14px;font-weight:600;color:var(--text-1)">' + esc(g.name) + '</div>' +
        '<div style="font-size:10px;background:var(--accent-dim);color:var(--text-accent);' +
        'padding:2px 8px;border-radius:20px;font-family:var(--font-mono)">' +
        groupOrgs.length + ' org' + (groupOrgs.length !== 1 ? 's' : '') + '</div>' +
        '<div style="margin-left:auto;font-size:10px;color:var(--text-3)">id: ' + esc(g.id.slice(0,8)) + '&hellip;</div>' +
      '</div>';

    // Org list
    var orgRows = groupOrgs.map(function(o){
      var tier = o.trustTier || 'participant';
      var tierColor = tier === 'trusted' ? 'var(--ok)' : tier === 'observer' ? 'var(--muted)' : 'var(--accent)';
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;' +
        'border-bottom:1px solid var(--border-faint)">' +
        '<div style="width:7px;height:7px;border-radius:50%;background:' + tierColor + ';flex-shrink:0"></div>' +
        '<div style="flex:1;color:var(--text-1);font-size:12px">' + esc(o.name) + '</div>' +
        '<div style="color:var(--text-3);font-size:10px;font-family:var(--font-mono)">' + esc(o.tenantId) + '</div>' +
        '<div style="color:' + tierColor + ';font-size:10px;width:72px;text-align:right">' + esc(tier) + '</div>' +
        '</div>';
    }).join('');

    // Sharing matrix
    var sharingHtml = '';
    if(groupOrgs.length > 1){
      var headerCells = '<th style="padding:4px 10px;min-width:20px"></th>' +
        groupOrgs.map(function(o){
          return '<th style="color:var(--text-3);font-size:10px;padding:4px 10px;font-weight:400;white-space:nowrap">' +
            esc(o.name.split(' ').slice(0,2).join(' ')) + '</th>';
        }).join('');

      var matrixRows = groupOrgs.map(function(from){
        var cells = groupOrgs.map(function(to){
          if(from.id === to.id)
            return '<td style="background:var(--bg-elevated);color:var(--text-3);text-align:center;padding:4px 10px;font-size:12px">&mdash;</td>';
          var policy = null;
          for(var i=0;i<policies.length;i++){
            if(policies[i].fromOrgId === from.id && policies[i].toOrgId === to.id){ policy=policies[i]; break; }
          }
          var mode = policy ? policy.mode : 'none';
          var modeColor = mode === 'bidirectional' ? 'var(--ok)' : mode === 'read' ? 'var(--accent)' : 'var(--text-3)';
          var modeIcon  = mode === 'bidirectional' ? '&#8644;' : mode === 'read' ? '&#8594;' : '&#10005;';
          return '<td style="text-align:center;padding:4px 10px;font-size:12px;color:' + modeColor + '">' + modeIcon + '</td>';
        }).join('');
        return '<tr><td style="color:var(--text-2);font-size:10px;padding:4px 10px;white-space:nowrap;font-family:var(--font-mono)">' +
          esc(from.name.split(' ').slice(0,2).join(' ')) + '</td>' + cells + '</tr>';
      }).join('');

      sharingHtml =
        '<div style="margin-top:14px">' +
        '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:6px">Sharing matrix</div>' +
        '<div style="overflow-x:auto">' +
        '<table style="border-collapse:collapse;background:var(--bg-elevated);border-radius:var(--r-sm);overflow:hidden;min-width:100%">' +
        '<thead><tr>' + headerCells + '</tr></thead>' +
        '<tbody>' + matrixRows + '</tbody>' +
        '</table></div></div>';
    }

    card.innerHTML = header +
      (orgRows ? '<div>' + orgRows + '</div>' : '<div style="color:var(--text-3);font-size:11px;padding:4px 0">No orgs added yet.</div>') +
      sharingHtml;
    el.appendChild(card);
  });
}

document.getElementById('nav-fleet').addEventListener('click', function(){ showView('fleet'); });
document.getElementById('nav-groups').addEventListener('click', function(){ showView('groups'); });
document.getElementById('nav-cloud').addEventListener('click', function(){ showView('cloud'); });
document.getElementById('nav-group-intel').addEventListener('click', function(){ showView('group-intel'); });
document.getElementById('btn-groups-refresh').addEventListener('click', function(){ loadGroups(); });
document.getElementById('btn-cloud-refresh').addEventListener('click', function(){ loadCloud(); });
document.getElementById('btn-group-intel-refresh').addEventListener('click', function(){ loadGroupIntel(); });

// ── Cloud panel ──────────────────────────────────────────────

function loadCloud(){
  document.getElementById('cloud-content').innerHTML =
    '<div style="color:var(--text-3);font-size:12px;padding:8px 0">Loading&hellip;</div>';
  fetch('/cloud/status').then(function(r){ return r.json(); }).then(function(data){
    renderCloud(data);
  }).catch(function(err){
    document.getElementById('cloud-content').innerHTML =
      '<div style="color:var(--error);font-size:12px">' + esc(String(err)) + '</div>';
  });
}

function renderCloud(data){
  var el = document.getElementById('cloud-content');

  if(!data.configured){
    el.innerHTML =
      '<div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:18px 20px">' +
      '<div style="color:var(--warn);font-size:13px;font-weight:600;margin-bottom:8px">&#9888; Not configured</div>' +
      '<div style="color:var(--text-3);font-size:12px;line-height:1.8">' +
      'Cloud sync is not configured.<br>' +
      'Run: <code style="font-family:var(--font-mono)">ctxhub cloud configure --endpoint &lt;url&gt; --api-key &lt;key&gt;</code>' +
      '</div></div>';
    return;
  }

  var lastSync = data.lastSyncAt ? new Date(data.lastSyncAt).toLocaleString() : 'Never';

  var statusCard =
    '<div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:18px 20px;margin-bottom:16px">' +
    '<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">' +
    '<div style="width:8px;height:8px;border-radius:50%;background:var(--ok)"></div>' +
    '<div style="font-size:13px;font-weight:600;color:var(--text-1)">Connected</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:120px 1fr;gap:6px 12px;font-size:12px">' +
    '<div style="color:var(--text-3)">Endpoint</div>' +
    '<div style="color:var(--text-1);font-family:var(--font-mono)">' + esc(data.endpoint || '—') + '</div>' +
    '<div style="color:var(--text-3)">Last sync</div>' +
    '<div style="color:var(--text-1)">' + esc(lastSync) + '</div>' +
    '<div style="color:var(--text-3)">Chunks synced</div>' +
    '<div style="color:var(--text-1)">' + (data.chunksSynced || 0) + '</div>' +
    '<div style="color:var(--text-3)">Available now</div>' +
    '<div style="color:var(--text-accent)">' + (data.chunksAvailable || 0) + ' institutional/canonical chunks</div>' +
    '</div>' +
    '<div style="margin-top:16px">' +
    '<button class="act-btn pri" id="btn-sync-now" style="font-size:12px;padding:7px 16px">&#9729; Sync Now</button>' +
    '<span id="sync-result" style="margin-left:12px;font-size:11px;color:var(--text-3)"></span>' +
    '</div>' +
    '</div>';

  var chunksHeader =
    '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Recently synced chunks</div>';

  var chunksEmpty =
    '<div style="background:var(--bg-surface);border:1px solid var(--border-faint);border-radius:var(--r);padding:14px 16px;' +
    'color:var(--text-3);font-size:12px">No sync history available yet. Click Sync Now to push chunks to Cloud.</div>';

  var historySection =
    '<div id="cloud-history-runs" style="margin-top:20px">' +
    '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Captain Runs History</div>' +
    '<div style="color:var(--text-3);font-size:12px;padding:8px 0">Loading&hellip;</div>' +
    '</div>' +
    '<div id="cloud-history-notes" style="margin-top:16px">' +
    '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Promoted Notes History</div>' +
    '<div style="color:var(--text-3);font-size:12px;padding:8px 0">Loading&hellip;</div>' +
    '</div>';

  el.innerHTML = statusCard + chunksHeader + chunksEmpty + historySection;

  // Load historical data
  loadCloudHistory();

  document.getElementById('btn-sync-now').addEventListener('click', function(){
    var btn = document.getElementById('btn-sync-now');
    var result = document.getElementById('sync-result');
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    result.textContent = '';
    fetch('/cloud/sync', { method: 'POST' }).then(function(r){ return r.json(); }).then(function(d){
      btn.disabled = false;
      btn.innerHTML = '&#9729; Sync Now';
      if(d.error){
        result.style.color = 'var(--error)';
        result.textContent = d.error;
      } else if(d.skipped){
        result.style.color = 'var(--warn)';
        result.textContent = 'Skipped — no eligible chunks';
      } else {
        result.style.color = 'var(--ok)';
        result.textContent = '✓ Synced ' + (d.synced || 0) + ' chunks';
        // Refresh status card after sync
        setTimeout(loadCloud, 800);
      }
    }).catch(function(err){
      btn.disabled = false;
      btn.innerHTML = '&#9729; Sync Now';
      result.style.color = 'var(--error)';
      result.textContent = String(err);
    });
  });
}

function loadCloudHistory(){
  fetch('/cloud/history?type=runs&limit=10').then(function(r){ return r.json(); }).then(function(data){
    var el = document.getElementById('cloud-history-runs');
    if(!el) return;
    var runs = data.runs || [];
    if(!runs.length){
      el.innerHTML =
        '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Captain Runs History</div>' +
        '<div style="background:var(--bg-surface);border:1px solid var(--border-faint);border-radius:var(--r);padding:14px 16px;color:var(--text-3);font-size:12px">' +
        'No captain runs synced yet. Runs appear here after <code style="font-family:var(--font-mono)">ctxhub cloud sync</code>.' +
        '</div>';
      return;
    }
    var statusColor = {'completed':'var(--ok)','failed':'var(--error)','running':'var(--warn)'};
    var rows = runs.map(function(r){
      var sc = (statusColor[r.status]) || 'var(--text-3)';
      var completed = r.completedAt ? new Date(r.completedAt).toLocaleString() : '--';
      return '<tr>' +
        '<td style="padding:5px 8px;font-size:11px;color:var(--text-1)">' + esc(r.taskName||'') + '</td>' +
        '<td style="padding:5px 8px;font-size:11px;color:'+sc+'">' + esc(r.status||'') + '</td>' +
        '<td style="padding:5px 8px;font-size:11px;color:var(--text-2);text-align:right">' + (r.findingsCount||0) + '</td>' +
        '<td style="padding:5px 8px;font-size:11px;color:var(--text-2);text-align:right">' + (r.promotedCount||0) + '</td>' +
        '<td style="padding:5px 8px;font-size:11px;color:var(--text-3)">' + esc(completed) + '</td>' +
        '</tr>';
    }).join('');
    el.innerHTML =
      '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Captain Runs History</div>' +
      '<div style="overflow-x:auto">' +
      '<table style="border-collapse:collapse;width:100%;background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--r)">' +
      '<thead><tr>' +
      '<th style="padding:6px 8px;font-size:10px;color:var(--text-3);text-align:left;font-weight:400">Task</th>' +
      '<th style="padding:6px 8px;font-size:10px;color:var(--text-3);text-align:left;font-weight:400">Status</th>' +
      '<th style="padding:6px 8px;font-size:10px;color:var(--text-3);text-align:right;font-weight:400">Findings</th>' +
      '<th style="padding:6px 8px;font-size:10px;color:var(--text-3);text-align:right;font-weight:400">Promoted</th>' +
      '<th style="padding:6px 8px;font-size:10px;color:var(--text-3);text-align:left;font-weight:400">Completed</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }).catch(function(){
    var el = document.getElementById('cloud-history-runs');
    if(el) el.innerHTML =
      '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Captain Runs History</div>' +
      '<div style="color:var(--text-3);font-size:12px">Could not load run history.</div>';
  });

  fetch('/cloud/history?type=notes&limit=10').then(function(r){ return r.json(); }).then(function(data){
    var el = document.getElementById('cloud-history-notes');
    if(!el) return;
    var notes = data.notes || [];
    if(!notes.length){
      el.innerHTML =
        '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Promoted Notes History</div>' +
        '<div style="background:var(--bg-surface);border:1px solid var(--border-faint);border-radius:var(--r);padding:14px 16px;color:var(--text-3);font-size:12px">' +
        'No promoted notes synced yet.' +
        '</div>';
      return;
    }
    var tierColor = {'institutional':'var(--ok)','canonical':'var(--accent)'};
    var cards = notes.map(function(n){
      var tc = (tierColor[n.trustTier]) || 'var(--text-3)';
      var promotedAt = n.promotedAt ? new Date(n.promotedAt).toLocaleDateString() : '--';
      return '<div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--r);padding:10px 14px;margin-bottom:8px">' +
        '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">' +
        '<div style="font-size:12px;font-weight:600;color:var(--text-1);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(n.title||'(untitled)') + '</div>' +
        '<div style="font-size:10px;padding:2px 8px;border-radius:20px;background:var(--accent-dim);color:'+tc+';white-space:nowrap">' + esc(n.trustTier||'') + '</div>' +
        '</div>' +
        '<div style="font-size:11px;color:var(--text-3)">by ' + esc(n.promotedBy||'') + ' &middot; ' + promotedAt + '</div>' +
        '</div>';
    }).join('');
    el.innerHTML =
      '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Promoted Notes History</div>' +
      cards;
  }).catch(function(){
    var el = document.getElementById('cloud-history-notes');
    if(el) el.innerHTML =
      '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:8px">Promoted Notes History</div>' +
      '<div style="color:var(--text-3);font-size:12px">Could not load notes history.</div>';
  });
}

// ── Group Intel panel ────────────────────────────────────────────────

function loadGroupIntel(){
  document.getElementById('group-intel-content').innerHTML =
    '<div style="color:var(--text-3);font-size:12px;padding:8px 0">Loading&hellip;</div>';
  fetch('/group/intel').then(function(r){ return r.json(); }).then(function(data){
    renderGroupIntel(data);
  }).catch(function(err){
    document.getElementById('group-intel-content').innerHTML =
      '<div style="color:var(--error);font-size:12px">' + esc(String(err)) + '</div>';
  });
}

function renderGroupIntel(data){
  var el = document.getElementById('group-intel-content');

  if(!data.group){
    el.innerHTML =
      '<div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:18px 20px">' +
      '<div style="color:var(--warn);font-size:13px;font-weight:600;margin-bottom:8px">&#9888; No group membership</div>' +
      '<div style="color:var(--text-3);font-size:12px;line-height:1.8">' +
      'Your account is not a member of any corporate group.<br>' +
      'Contact your group administrator or run: <code style="font-family:var(--font-mono)">ctxhub group create</code>' +
      '</div></div>';
    return;
  }

  var group = data.group;
  var orgs = group.orgs || [];
  var chunks = data.promotedChunks || [];
  var events = data.recentEvents || [];

  // Group header card
  var header =
    '<div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:18px 20px;margin-bottom:16px">' +
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">' +
    '<span style="color:var(--text-accent);font-size:16px">&#9768;</span>' +
    '<div style="font-size:14px;font-weight:600;color:var(--text-1)">' + esc(group.name) + '</div>' +
    '<div style="font-size:10px;background:var(--accent-dim);color:var(--text-accent);padding:2px 8px;border-radius:20px;font-family:var(--font-mono)">' +
    orgs.length + ' org' + (orgs.length !== 1 ? 's' : '') + '</div>' +
    '<div style="margin-left:auto;font-size:10px;color:var(--text-3)">id: ' + esc(group.id.slice(0,8)) + '&hellip;</div>' +
    '</div>';

  // Org rows
  var orgRows = orgs.map(function(o){
    var tier = o.trustTier || 'participant';
    var tierColor = tier === 'trusted' ? 'var(--ok)' : tier === 'observer' ? 'var(--muted)' : 'var(--accent)';
    var lastSeen = o.lastSeen ? new Date(o.lastSeen).toLocaleString() : 'Never';
    var peerStatus = o.peerUrl
      ? '<span style="color:var(--ok);font-size:10px">&#10003; configured</span>'
      : '<span style="color:var(--text-3);font-size:10px">&#10005; not configured</span>';

    // Sharing summary for this org
    var sharingPolicies = o.sharingPolicies || [];
    var sharingBadges = sharingPolicies.map(function(p){
      var mode = p.mode || 'none';
      var c = mode === 'bidirectional' ? 'var(--ok)' : mode === 'read' ? 'var(--accent)' : 'var(--text-3)';
      var icon = mode === 'bidirectional' ? '&#8644;' : mode === 'read' ? '&#8594;' : '&#10005;';
      return '<span style="color:' + c + ';font-size:11px">' + icon + '</span>';
    }).join(' ');

    return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border-faint)">' +
      '<div style="width:7px;height:7px;border-radius:50%;background:' + tierColor + ';flex-shrink:0"></div>' +
      '<div style="flex:1;color:var(--text-1);font-size:12px">' + esc(o.name) + '</div>' +
      '<div style="color:var(--text-3);font-size:10px">' + esc(lastSeen) + '</div>' +
      '<div style="font-size:10px">' + peerStatus + '</div>' +
      (sharingBadges ? '<div style="font-size:11px">' + sharingBadges + '</div>' : '') +
      '<div style="color:' + tierColor + ';font-size:10px;width:72px;text-align:right">' + esc(tier) + '</div>' +
      '</div>';
  }).join('');

  header += (orgRows ? '<div>' + orgRows + '</div>' : '<div style="color:var(--text-3);font-size:11px;padding:4px 0">No orgs in this group.</div>') + '</div>';

  // Promoted findings card
  var chunksCard =
    '<div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:18px 20px;margin-bottom:16px">' +
    '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px">Promoted findings</div>';

  if(!chunks.length){
    chunksCard += '<div style="background:var(--bg-elevated);border:1px solid var(--border-faint);border-radius:var(--r);padding:12px 14px;color:var(--text-3);font-size:12px">No active knowledge objects found. Promote a finding using <code style="font-family:var(--font-mono)">ctxhub knowledge promote</code>.</div>';
  } else {
    chunksCard += chunks.map(function(c){
      var conf = typeof c.confidence === 'number' ? Math.round(c.confidence * 100) + '%' : '—';
      return '<div style="display:flex;align-items:flex-start;gap:10px;padding:6px 0;border-bottom:1px solid var(--border-faint)">' +
        '<div style="flex:1;min-width:0">' +
        '<div style="color:var(--text-1);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(c.title || '(untitled)') + '</div>' +
        '<div style="color:var(--text-3);font-size:10px;font-family:var(--font-mono)">' + esc(c.workspace || '') + '</div>' +
        '</div>' +
        '<div style="color:var(--accent);font-size:10px;flex-shrink:0">' + conf + '</div>' +
        '</div>';
    }).join('');
  }
  chunksCard += '</div>';

  // Recent audit events card
  var eventsCard =
    '<div style="background:var(--bg-surface);border:1px solid var(--border-subtle);border-radius:var(--r-lg);padding:18px 20px">' +
    '<div style="color:var(--text-3);font-size:10px;text-transform:uppercase;letter-spacing:0.06em;margin-bottom:10px">Recent audit events</div>';

  if(!events.length){
    eventsCard += '<div style="background:var(--bg-elevated);border:1px solid var(--border-faint);border-radius:var(--r);padding:12px 14px;color:var(--text-3);font-size:12px">No audit events recorded yet.</div>';
  } else {
    eventsCard += events.map(function(e){
      var ts = e.ts ? new Date(e.ts).toLocaleString() : '—';
      var actor = e.actor || e.sub || '—';
      return '<div style="display:flex;align-items:center;gap:10px;padding:5px 0;border-bottom:1px solid var(--border-faint)">' +
        '<div style="color:var(--accent);font-size:11px;flex-shrink:0;width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(e.type || '') + '</div>' +
        '<div style="flex:1;color:var(--text-3);font-size:10px;font-family:var(--font-mono);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(actor) + '</div>' +
        '<div style="color:var(--text-3);font-size:10px;flex-shrink:0">' + esc(ts) + '</div>' +
        '</div>';
    }).join('');
  }
  eventsCard += '</div>';

  el.innerHTML = header + chunksCard + eventsCard;
}

// ── Server-Sent Events ────────────────────────────────────────
// Connect to /events for real-time updates. Falls back to 30s polling on error.
var sseConnected = false;
var pollInterval = null;

function startPolling(){
  if(pollInterval) return;
  pollInterval = setInterval(function(){
    state.workspaces.forEach(function(ws){ fetchWsStatus(ws.name); });
  }, 30000);
}

function stopPolling(){
  if(pollInterval){ clearInterval(pollInterval); pollInterval = null; }
}

function setSseIndicator(connected){
  sseConnected = connected;
  var ind = document.getElementById('sse-indicator');
  if(!ind) return;
  ind.textContent = connected ? '● Live' : '○ Offline';
  ind.style.color = connected ? 'var(--ok)' : 'var(--warn)';
}

function connectSSE(){
  var es = new EventSource('/events');

  es.addEventListener('open', function(){
    setSseIndicator(true);
    stopPolling();
  });

  es.addEventListener('error', function(){
    setSseIndicator(false);
    startPolling();
  });

  // captain_run_complete → refresh captains data (refetch workspace statuses)
  es.addEventListener('message', function(e){
    try {
      var event = JSON.parse(e.data);
      if(event.type === 'captain.run.completed'){
        addActivity('<strong>Captain</strong> run complete: ' + esc(event.task||'') + ' on ' + esc(event.workspace||''), 'ok');
        state.workspaces.forEach(function(ws){ fetchWsStatus(ws.name); });
      } else if(event.type === 'index.completed'){
        addActivity('<strong>Index</strong> complete: ' + esc(event.workspace||''), 'ok');
        fetchWsStatus(event.workspace);
      } else if(event.type === 'job.completed'){
        addActivity('<strong>Job</strong> complete: ' + esc(event.job||''), 'ok');
      }
    } catch(err) { /* ignore malformed events */ }
  });
}

// ── Auto-refresh every 30s (fallback when SSE unavailable) ───────────────────
startPolling();

// ── Boot ─────────────────────────────────────────────────────
loadFleet();
connectSSE();
</script>
</body>
</html>`;
}
