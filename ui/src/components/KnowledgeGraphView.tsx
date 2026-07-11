import { useRef, useEffect, useState, useCallback, useMemo, type ReactNode } from 'react'
import * as d3 from 'd3'
import { BookOpen, ChevronDown, X } from 'lucide-react'
import { useWorkspaces, useKnowledgeGraph, useKnowledgeGraphNode, fetchKnowledgeGraphExpand } from '../api/client'
import { relTime } from '../lib/utils'
import { useFleetStore } from '../store/fleet'
import type { KnowledgeGraphEdge, KnowledgeGraphNode } from '../types'

interface NodeDatum extends d3.SimulationNodeDatum {
  id: string
  label: string
  repo: string
  kind: 'file' | 'component'
  connections: number
}

interface LinkDatum extends d3.SimulationLinkDatum<NodeDatum> {
  source: NodeDatum
  target: NodeDatum
  kind: 'diagram' | 'similarity'
}

const REPO_PALETTE = ['#7c6ef5', '#22d3ee', '#f5a623', '#0fd97b', '#f03d3d', '#e879f9']

function repoColor(repo: string, repos: string[]): string {
  const i = repos.indexOf(repo)
  return REPO_PALETTE[i % REPO_PALETTE.length] ?? '#7c6ef5'
}

const MAX_HIGHLIGHT_MATCHES = 400

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Renders `text` as-is when there's no active search, otherwise wraps every case-insensitive
// match of `query` in a <mark> -- same query driving the graph's own dim/highlight filtering, so
// what's dimmed on the canvas and what's marked in the preview always agree on what "matches"
// means. Capped rather than unbounded: a short, very common query against a 200k-char file could
// otherwise produce thousands of <mark> elements and visibly stall the render.
//
// `startIndex` is this text block's offset into the panel-wide match sequence (summary, then
// content, then diagrams, in render order) so navigation can address "match 7" without caring
// which section it's actually in; `activeIndex` picks which single mark, if any, renders as the
// "current" one (data-match-index lets the nav effect find and scroll to it by that same number).
function highlightMatches(text: string, query: string, startIndex: number, activeIndex: number): { node: ReactNode; count: number } {
  const q = query.trim()
  if (!q) return { node: text, count: 0 }

  const re = new RegExp(`(${escapeRegExp(q)})`, 'gi')
  const parts = text.split(re)
  if (parts.length <= 1) return { node: text, count: 0 }

  let localCount = 0
  const node = parts.map((part, i) => {
    const isMatch = i % 2 === 1
    if (!isMatch) return <span key={i}>{part}</span>
    const globalIndex = startIndex + localCount
    localCount++
    if (globalIndex >= MAX_HIGHLIGHT_MATCHES) return <span key={i}>{part}</span>
    const isActive = globalIndex === activeIndex
    return (
      <mark
        key={i}
        data-match-index={globalIndex}
        style={{
          background: isActive ? 'rgba(124,110,245,0.75)' : 'rgba(245,166,35,0.45)',
          color: isActive ? 'white' : 'inherit',
          borderRadius: 2,
        }}
      >
        {part}
      </mark>
    )
  })
  return { node, count: localCount }
}

// Same right-hand slide-in pattern as DetailPanel/EventDetailPanel elsewhere in this app --
// clicking a node previews what's actually indexed for it, not just the label/repo/connection
// count the hover tooltip already shows.
function NodePreviewPanel({ workspace, nodeId, query, onClose }: { workspace: string; nodeId: string; query: string; onClose: () => void }) {
  const { data, isLoading, error } = useKnowledgeGraphNode(workspace, nodeId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [activeMatch, setActiveMatch] = useState(0)

  // An active-match index from a previous file or query wouldn't point at anything meaningful
  // for a new one.
  useEffect(() => {
    setActiveMatch(0)
  }, [nodeId, query])

  // Sections render in a fixed order (summary, then content, then diagrams in array order), so a
  // running offset computed here in plain JS -- before the JSX below ever touches it -- gives
  // every match a stable global index without needing refs threaded through each section.
  let matchOffset = 0
  let summaryHighlighted: ReactNode = data?.kind === 'file' ? data.summary : undefined
  let contentHighlighted: ReactNode = data?.kind === 'file' ? data.content : undefined
  let diagramsHighlighted: ReactNode[] = data?.kind === 'component' ? data.diagrams.map(d => d.content) : []

  if (data?.kind === 'file') {
    if (data.summary) {
      const r = highlightMatches(data.summary, query, matchOffset, activeMatch)
      summaryHighlighted = r.node
      matchOffset += r.count
    }
    const r = highlightMatches(data.content, query, matchOffset, activeMatch)
    contentHighlighted = r.node
    matchOffset += r.count
  } else if (data?.kind === 'component') {
    diagramsHighlighted = data.diagrams.map(d => {
      const r = highlightMatches(d.content, query, matchOffset, activeMatch)
      matchOffset += r.count
      return r.node
    })
  }
  const totalMatches = matchOffset

  // Jump to (and keep in view) the current match instead of leaving the reader to scroll and
  // hunt for it -- fires on open, on query change (both reset activeMatch to 0 above), and on
  // every prev/next click.
  useEffect(() => {
    if (totalMatches === 0) return
    const id = requestAnimationFrame(() => {
      scrollRef.current?.querySelector(`mark[data-match-index="${activeMatch}"]`)?.scrollIntoView({ block: 'center' })
    })
    return () => cancelAnimationFrame(id)
  }, [activeMatch, totalMatches, data])

  return (
    <div
      className="absolute right-0 top-0 h-full animate-slide-in-right flex flex-col"
      style={{ width: 360, background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)', zIndex: 20 }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          File content
        </span>
        <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>
          <X size={14} />
        </button>
      </div>

      {totalMatches > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b" style={{ borderColor: 'var(--border)' }}>
          <span className="text-[11px] flex-1" style={{ color: 'var(--text-muted)' }}>
            Match {activeMatch + 1} of {totalMatches}
            {totalMatches >= MAX_HIGHLIGHT_MATCHES ? '+' : ''}
          </span>
          <button
            onClick={() => setActiveMatch(m => (m - 1 + totalMatches) % totalMatches)}
            className="w-6 h-6 flex items-center justify-center rounded-md"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            title="Previous match"
          >
            <ChevronDown size={12} style={{ transform: 'rotate(180deg)' }} />
          </button>
          <button
            onClick={() => setActiveMatch(m => (m + 1) % totalMatches)}
            className="w-6 h-6 flex items-center justify-center rounded-md"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
            title="Next match"
          >
            <ChevronDown size={12} />
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {isLoading && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Loading…
          </p>
        )}
        {error && (
          <p className="text-xs" style={{ color: 'var(--health-error)' }}>
            {(error as Error).message}
          </p>
        )}

        {data?.kind === 'file' && (
          <>
            <div>
              <h2 className="text-sm font-semibold break-all" style={{ color: 'var(--text-primary)' }}>
                {data.filePath}
              </h2>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {data.repo} · indexed {relTime(data.lastIndexed)}
              </p>
              {data.contentSource === 'index' && (
                <p className="text-[11px] mt-1 px-2 py-1 rounded" style={{ background: 'rgba(245,166,35,0.12)', color: 'var(--health-warn)' }}>
                  File no longer found on disk at its indexed path — showing the last indexed snapshot instead.
                </p>
              )}
            </div>

            {data.summary && (
              <div>
                <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                  Indexed summary
                </p>
                <p className="text-[11px] leading-relaxed p-2 rounded-md" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                  {summaryHighlighted}
                </p>
              </div>
            )}

            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                {data.contentSource === 'disk' ? 'File content' : 'Last indexed content'}
              </p>
              <pre
                className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono p-3 rounded-md"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
              >
                {contentHighlighted}
              </pre>
              {data.truncated && (
                <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Truncated — file is larger than the preview limit.
                </p>
              )}
            </div>
          </>
        )}

        {data?.kind === 'component' && (
          <>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {data.id}
              </h2>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                Logical component named in {data.diagrams.length} architecture diagram{data.diagrams.length === 1 ? '' : 's'} — not a file
              </p>
            </div>
            {data.diagrams.map((diagram, i) => (
              <div key={i}>
                <p className="text-[11px] font-mono mb-1" style={{ color: 'var(--text-muted)' }}>
                  {diagram.repo}:{diagram.filePath}
                </p>
                <pre
                  className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono p-3 rounded-md"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
                >
                  {diagramsHighlighted[i]}
                </pre>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}

// A note graph, not a workspace graph -- one node per indexed file (plus diagram-derived
// "component" nodes), edges are real relationships (search-similarity or parsed Mermaid
// relationships) pulled from src/indexing/knowledgeGraph.ts, not a synthetic layout. Same
// force-directed canvas approach as GraphCanvas.tsx's Fleet view, but a distinct graph over
// distinct data -- knowledge, not workspace health.
export function KnowledgeGraphView() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<d3.Simulation<NodeDatum, LinkDatum> | null>(null)
  const nodesRef = useRef<NodeDatum[]>([])
  const linksRef = useRef<LinkDatum[]>([])
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity)
  const rafRef = useRef<number>(0)
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null)
  const hoveredRef = useRef<string | null>(null)
  const selectedRef = useRef<string | null>(null)
  const visibleRef = useRef<Set<string> | null>(null)
  // Nodes already expanded this session (bulk-build edges or a prior click) -- skips a redundant
  // identical search when the same node is clicked again.
  const expandedRef = useRef<Set<string>>(new Set())

  const { data: wsData } = useWorkspaces()
  const workspaces = wsData?.workspaces ?? []
  const [workspace, setWorkspace] = useState<string | null>(null)
  useEffect(() => {
    if (!workspace && workspaces.length > 0) setWorkspace(workspaces[0].name)
  }, [workspace, workspaces])

  const { data: graph, isLoading } = useKnowledgeGraph(workspace)
  const [hovered, setHovered] = useState<NodeDatum | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  // Memoized so hovering (which sets `hovered` state and re-renders this component) doesn't
  // produce a new array reference on every render -- `repos` is a dependency of the simulation
  // effect below, and a fresh reference each render would restart the whole force simulation on
  // every hover instead of only when the underlying graph actually changes.
  const repos = useMemo(() => (graph ? [...new Set(graph.nodes.map(n => n.repo))] : []), [graph])

  // Filtering/search narrows down *which* nodes are highlighted rather than removing them from
  // the simulation -- refiltering on every keystroke would otherwise reflow the whole layout and
  // fight the user's own panning/zooming. `visible` is undefined (not an empty Set) when no
  // filter is active, so the draw loop can tell "no filter" apart from "filter matches nothing."
  const [searchText, setSearchText] = useState('')
  const [repoFilter, setRepoFilter] = useState<string>('all')
  const [kindFilter, setKindFilter] = useState<'all' | 'file' | 'component'>('all')
  const hasActiveFilter = searchText.trim() !== '' || repoFilter !== 'all' || kindFilter !== 'all'

  const visible = useMemo(() => {
    if (!graph || !hasActiveFilter) return undefined
    const q = searchText.trim().toLowerCase()
    const ids = new Set<string>()
    for (const node of graph.nodes) {
      if (kindFilter !== 'all' && node.kind !== kindFilter) continue
      if (repoFilter !== 'all' && node.repo !== repoFilter) continue
      if (q && !node.label.toLowerCase().includes(q) && !node.id.toLowerCase().includes(q)) continue
      ids.add(node.id)
    }
    return ids
  }, [graph, hasActiveFilter, searchText, repoFilter, kindFilter])

  useEffect(() => {
    visibleRef.current = visible ?? null
  }, [visible])

  // Rebuild the simulation whenever the graph data changes -- unlike GraphCanvas's mount-once
  // setup, this view is remounted per workspace switch anyway (state resets), so there's no
  // stale-closure concern here: the draw loop closes over `graph`/`repos` freshly each time this
  // effect reruns.
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container || !graph) return

    const W = container.clientWidth
    const H = container.clientHeight
    canvas.width = W
    canvas.height = H

    const nodeById = new Map<string, NodeDatum>()
    const nodes: NodeDatum[] = graph.nodes.map((n: KnowledgeGraphNode) => {
      const datum: NodeDatum = { id: n.id, label: n.label, repo: n.repo, kind: n.kind, connections: n.connections }
      nodeById.set(n.id, datum)
      return datum
    })
    const links: LinkDatum[] = graph.edges
      .map((e: KnowledgeGraphEdge) => {
        const source = nodeById.get(e.source)
        const target = nodeById.get(e.target)
        if (!source || !target) return null
        return { source, target, kind: e.kind } as LinkDatum
      })
      .filter((l): l is LinkDatum => l !== null)

    nodesRef.current = nodes
    linksRef.current = links
    expandedRef.current = new Set()

    const sim = d3
      .forceSimulation<NodeDatum>(nodes)
      .force('charge', d3.forceManyBody<NodeDatum>().strength(-90))
      .force('link', d3.forceLink<NodeDatum, LinkDatum>(links).id(d => d.id).distance(60).strength(0.3))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide<NodeDatum>(d => 6 + Math.min(d.connections, 10)))
    simRef.current = sim

    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 4])
      .on('zoom', e => {
        transformRef.current = e.transform as d3.ZoomTransform
      })
    zoomBehaviorRef.current = zoom
    d3.select(canvas).call(zoom)

    function screenToWorld(sx: number, sy: number) {
      const t = transformRef.current
      return { x: (sx - t.x) / t.k, y: (sy - t.y) / t.k }
    }

    function hitTest(sx: number, sy: number): NodeDatum | null {
      const { x, y } = screenToWorld(sx, sy)
      const t = transformRef.current
      for (const node of nodesRef.current) {
        if (node.x == null || node.y == null) continue
        const r = (4 + Math.min(node.connections, 10)) / t.k + 3
        const dx = node.x - x
        const dy = node.y - y
        if (Math.sqrt(dx * dx + dy * dy) < r) return node
      }
      return null
    }

    function handleMouseMove(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect()
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
      hoveredRef.current = hit?.id ?? null
      canvas!.style.cursor = hit ? 'pointer' : 'grab'
      setHovered(hit)
    }
    canvas.addEventListener('mousemove', handleMouseMove)

    // Obsidian-style free navigation: a file node past the bulk build's similarity-edge budget
    // (or, in a huge workspace, simply never searched-from yet) renders with no similarity edges.
    // Clicking it fires one on-demand search (fetchKnowledgeGraphExpand) and splices whatever
    // comes back straight into the running simulation, so panning/zooming the user already did
    // isn't disturbed -- only new links/labels appear. Best-effort: a failed expand still lets the
    // click open the preview panel via setSelectedNodeId above.
    async function expandNode(nodeId: string, ws: string) {
      if (expandedRef.current.has(nodeId)) return
      expandedRef.current.add(nodeId)
      let newEdges: KnowledgeGraphEdge[]
      try {
        newEdges = await fetchKnowledgeGraphExpand(ws, nodeId)
      } catch {
        return
      }
      if (newEdges.length === 0) return

      const nodeById = new Map(nodesRef.current.map(n => [n.id, n]))
      const existingKeys = new Set(
        linksRef.current.map(l => [(l.source as NodeDatum).id, (l.target as NodeDatum).id].sort().join('::'))
      )
      let added = 0
      for (const edge of newEdges) {
        const key = [edge.source, edge.target].sort().join('::')
        if (existingKeys.has(key)) continue
        const source = nodeById.get(edge.source)
        const target = nodeById.get(edge.target)
        if (!source || !target) continue
        existingKeys.add(key)
        linksRef.current.push({ source, target, kind: 'similarity' })
        source.connections++
        target.connections++
        added++
      }
      if (added === 0) return

      // Re-heat rather than restart from scratch -- the existing layout stays put, new links just
      // pull their two nodes gently toward each other on top of it.
      sim.force('link', d3.forceLink<NodeDatum, LinkDatum>(linksRef.current).id(d => d.id).distance(60).strength(0.3))
      sim.alpha(0.3).restart()
    }

    function handleClick(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect()
      const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
      selectedRef.current = hit?.id ?? null
      setSelectedNodeId(hit?.id ?? null)
      if (hit && hit.kind === 'file' && workspace) {
        void expandNode(hit.id, workspace)
      }
    }
    canvas.addEventListener('click', handleClick)

    function drawFrame() {
      const ctx = canvas!.getContext('2d')
      if (!ctx) return
      const w = canvas!.width
      const h = canvas!.height
      ctx.clearRect(0, 0, w, h)

      const t = transformRef.current
      ctx.save()
      ctx.translate(t.x, t.y)
      ctx.scale(t.k, t.k)

      const hoveredId = hoveredRef.current
      const neighborIds = new Set<string>()
      if (hoveredId) {
        for (const link of linksRef.current) {
          const s = link.source as NodeDatum
          const tg = link.target as NodeDatum
          if (s.id === hoveredId) neighborIds.add(tg.id)
          if (tg.id === hoveredId) neighborIds.add(s.id)
        }
      }

      // Edges -- dimmed to near-invisible (not skipped) when a filter is active and either
      // endpoint doesn't match, so the filtered subset's own shape stays legible without the
      // rest of the graph fully vanishing and reflowing.
      const activeFilter = visibleRef.current
      linksRef.current.forEach(link => {
        const s = link.source as NodeDatum
        const tg = link.target as NodeDatum
        if (s.x == null || s.y == null || tg.x == null || tg.y == null) return
        const isActive = hoveredId !== null && (s.id === hoveredId || tg.id === hoveredId)
        const filteredOut = activeFilter !== null && (!activeFilter.has(s.id) || !activeFilter.has(tg.id))
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(tg.x, tg.y)
        ctx.strokeStyle = isActive ? 'rgba(124,110,245,0.7)' : link.kind === 'diagram' ? 'rgba(124,110,245,0.25)' : 'rgba(90,90,128,0.18)'
        ctx.lineWidth = isActive ? 1.4 : link.kind === 'diagram' ? 1 : 0.6
        ctx.globalAlpha = filteredOut ? 0.06 : 1
        ctx.stroke()
        ctx.globalAlpha = 1
      })

      // Nodes
      const selectedId = selectedRef.current
      nodesRef.current.forEach(node => {
        if (node.x == null || node.y == null) return
        const isHovered = node.id === hoveredId
        const isSelected = node.id === selectedId
        const isNeighbor = neighborIds.has(node.id)
        const filteredOut = activeFilter !== null && !activeFilter.has(node.id)
        const dimmed = (hoveredId !== null && !isHovered && !isNeighbor) || filteredOut
        const r = 4 + Math.min(node.connections, 10)
        const color = repoColor(node.repo, repos)

        ctx.globalAlpha = filteredOut ? 0.12 : dimmed ? 0.25 : 1
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.kind === 'component' ? r * 0.8 : r, 0, Math.PI * 2)
        ctx.fillStyle = color
        ctx.fill()
        if (node.kind === 'component') {
          ctx.strokeStyle = '#0d0d1a'
          ctx.lineWidth = 1
          ctx.stroke()
        }
        if (isSelected) {
          ctx.beginPath()
          ctx.arc(node.x, node.y, r + 4, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(124,110,245,0.8)'
          ctx.lineWidth = 1.5
          ctx.stroke()
        }

        if (isHovered || isSelected || isNeighbor || t.k > 1.6 || (activeFilter !== null && activeFilter.has(node.id))) {
          ctx.font = '500 10px Inter, sans-serif'
          ctx.fillStyle = isHovered || isSelected ? '#eeeeff' : '#9898c0'
          ctx.textAlign = 'center'
          ctx.textBaseline = 'top'
          ctx.fillText(node.label.length > 22 ? node.label.slice(0, 21) + '…' : node.label, node.x, node.y + r + 3)
        }
        ctx.globalAlpha = 1
      })

      ctx.restore()
      rafRef.current = requestAnimationFrame(drawFrame)
    }
    rafRef.current = requestAnimationFrame(drawFrame)

    const ro = new ResizeObserver(() => {
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
    })
    ro.observe(container)

    return () => {
      cancelAnimationFrame(rafRef.current)
      sim.stop()
      canvas.removeEventListener('mousemove', handleMouseMove)
      canvas.removeEventListener('click', handleClick)
      ro.disconnect()
    }
  }, [graph, repos, workspace])

  // A node id is only meaningful for the graph it came from -- switching workspaces should never
  // leave a stale selection pointing at a node that no longer exists in the new graph.
  useEffect(() => {
    setSelectedNodeId(null)
  }, [workspace])

  const pendingKnowledgeFocus = useFleetStore(s => s.pendingKnowledgeFocus)
  const setPendingKnowledgeFocus = useFleetStore(s => s.setPendingKnowledgeFocus)

  const fitToNodes = useCallback((predicate?: (n: NodeDatum) => boolean) => {
    const canvas = canvasRef.current
    if (!canvas || !zoomBehaviorRef.current) return
    const nodes = nodesRef.current.filter(n => n.x != null && n.y != null && (!predicate || predicate(n)))
    if (nodes.length === 0) return
    const W = canvas.width
    const H = canvas.height
    const xs = nodes.map(n => n.x!)
    const ys = nodes.map(n => n.y!)
    const x0 = Math.min(...xs) - 30
    const y0 = Math.min(...ys) - 30
    const x1 = Math.max(...xs) + 30
    const y1 = Math.max(...ys) + 30
    d3.select(canvas)
      .transition()
      .duration(400)
      .call(
        zoomBehaviorRef.current.transform,
        d3.zoomIdentity
          .translate(W / 2, H / 2)
          .scale(Math.min(1.2, 0.9 / Math.max((x1 - x0) / W, (y1 - y0) / H)))
          .translate(-(x0 + x1) / 2, -(y0 + y1) / 2)
      )
  }, [])

  const handleFit = useCallback(() => fitToNodes(), [fitToNodes])

  useEffect(() => {
    if (graph) setTimeout(handleFit, 400)
  }, [graph, handleFit])

  // Deep link from a Chat citation click (see ChatPanel's jumpToCitation): switch to the target
  // workspace first if needed, then once that workspace's graph has actually loaded (not a stale
  // previous-workspace graph -- react-query returns `undefined` while the new query key is in
  // flight, so this bails cleanly rather than racing), select and fit the matching node. Cleared
  // after acting so it only ever fires once per click, and silently drops if the cited file isn't
  // (or is no longer) a graph node rather than getting stuck waiting forever.
  useEffect(() => {
    if (!pendingKnowledgeFocus) return
    if (workspace !== pendingKnowledgeFocus.workspace) {
      setWorkspace(pendingKnowledgeFocus.workspace)
      return
    }
    if (!graph) return
    const match = graph.nodes.find(n => n.id === pendingKnowledgeFocus.nodeId)
    if (match) {
      selectedRef.current = match.id
      setSelectedNodeId(match.id)
      setTimeout(() => fitToNodes(n => n.id === match.id), 450)
    }
    setPendingKnowledgeFocus(null)
  }, [pendingKnowledgeFocus, workspace, graph, fitToNodes, setPendingKnowledgeFocus])

  // Narrowing down via search/filter also re-frames the view around what matched -- "focus in on
  // certain files" means actually looking at them, not just dimming everything else in place.
  // Debounced so it settles after typing pauses instead of fighting every keystroke.
  useEffect(() => {
    if (!visible || visible.size === 0) return
    const t = setTimeout(() => fitToNodes(n => visible.has(n.id)), 450)
    return () => clearTimeout(t)
  }, [visible, fitToNodes])

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden" style={{ background: 'var(--bg-void)' }}>
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 px-4 py-3 space-y-2" style={{ background: 'linear-gradient(to bottom, var(--bg-void) 75%, transparent)' }}>
        <div className="flex items-center gap-3">
          <BookOpen size={15} style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Knowledge
          </span>
          <div className="flex items-center gap-1">
            <ChevronDown size={11} style={{ color: 'var(--text-muted)' }} />
            <select
              value={workspace ?? ''}
              onChange={e => setWorkspace(e.target.value || null)}
              className="text-xs"
              style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)' }}
            >
              {workspaces.map(ws => (
                <option key={ws.name} value={ws.name}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>
          {graph && (
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {visible ? `${visible.size} of ${graph.nodes.length} nodes` : `${graph.nodes.length} nodes · ${graph.edges.length} edges`}
              {graph.truncated ? ' · similarity links limited to the most recent files' : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Filter by file or component name…"
            className="text-xs rounded-md px-2.5 py-1.5 w-64"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <select
            value={repoFilter}
            onChange={e => setRepoFilter(e.target.value)}
            className="text-xs rounded-md px-2 py-1.5"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
          >
            <option value="all">All repos</option>
            {repos.map(r => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <div className="flex rounded-md overflow-hidden" style={{ border: '1px solid var(--border)' }}>
            {(['all', 'file', 'component'] as const).map(k => (
              <button
                key={k}
                onClick={() => setKindFilter(k)}
                className="text-[11px] px-2 py-1.5"
                style={{
                  background: kindFilter === k ? 'var(--accent-dim)' : 'var(--bg-surface)',
                  color: kindFilter === k ? 'var(--accent)' : 'var(--text-secondary)',
                }}
              >
                {k === 'all' ? 'All' : k === 'file' ? 'Files' : 'Components'}
              </button>
            ))}
          </div>
          {hasActiveFilter && (
            <button
              onClick={() => {
                setSearchText('')
                setRepoFilter('all')
                setKindFilter('all')
                setTimeout(handleFit, 50)
              }}
              className="text-[11px] flex items-center gap-1"
              style={{ color: 'var(--text-muted)' }}
            >
              <X size={11} />
              Clear
            </button>
          )}
        </div>
      </div>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" style={{ cursor: 'grab' }} />

      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Building knowledge graph…
          </p>
        </div>
      )}

      {!isLoading && graph && graph.nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <p className="text-2xl">📚</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Nothing indexed yet
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Run <code className="font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)' }}>ctxhub index</code> for this workspace
          </p>
        </div>
      )}

      {!isLoading && graph && graph.nodes.length > 0 && visible && visible.size === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            No files match this filter
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Try a different search term or repo
          </p>
        </div>
      )}

      {hovered && (
        <div
          className="absolute bottom-4 left-4 px-3 py-2 rounded-lg text-xs"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)', maxWidth: 320 }}
        >
          <div className="font-medium truncate">{hovered.label}</div>
          <div style={{ color: 'var(--text-muted)' }}>
            {hovered.repo} · {hovered.kind} · {hovered.connections} connection{hovered.connections === 1 ? '' : 's'}
          </div>
        </div>
      )}

      {selectedNodeId && workspace && (
        <NodePreviewPanel
          workspace={workspace}
          nodeId={selectedNodeId}
          query={searchText}
          onClose={() => {
            selectedRef.current = null
            setSelectedNodeId(null)
          }}
        />
      )}
    </div>
  )
}
