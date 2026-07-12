import { useMemo } from 'react'
import * as d3 from 'd3'
import { Zap, RefreshCw, AlertTriangle } from 'lucide-react'
import { useUsageStats } from '../api/client'
import { useFleetStore } from '../store/fleet'
import { relTime } from '../lib/utils'
import type { DailyUsage, ToolUsageSummary } from '../types'

const DONUT_COLORS = ['#7c6cf6', '#4ade80', '#38bdf8', '#fbbf24', '#fb7185', '#a3a3a3']

function formatCompact(n: number): string {
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

// ── Stat card ─────────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="p-3 rounded-md" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>{label}</p>
      <p className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>{value}</p>
      {sub && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </div>
  )
}

// ── Donut: per-tool tokens saved ─────────────────────────────────────────────

function ToolsDonut({ tools }: { tools: ToolUsageSummary[] }) {
  const size = 160
  const radius = size / 2
  const positive = tools.filter(t => t.tokensSaved > 0)

  const arcs = useMemo(() => {
    if (positive.length === 0) return []
    const pieGen = d3.pie<ToolUsageSummary>().value(d => d.tokensSaved).sort(null)
    const arcGen = d3.arc<d3.PieArcDatum<ToolUsageSummary>>().innerRadius(radius * 0.6).outerRadius(radius)
    return pieGen(positive).map((slice, i) => ({ path: arcGen(slice) ?? '', tool: slice.data.tool, color: DONUT_COLORS[i % DONUT_COLORS.length] }))
  }, [positive, radius])

  if (positive.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ width: size, height: size, color: 'var(--text-muted)', fontSize: 11 }}>
        No savings yet
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4">
      <svg width={size} height={size} viewBox={`${-radius} ${-radius} ${size} ${size}`}>
        {arcs.map(a => <path key={a.tool} d={a.path} fill={a.color} stroke="var(--bg-surface)" strokeWidth={1} />)}
      </svg>
      <div className="space-y-1.5">
        {positive.map((t, i) => (
          <div key={t.tool} className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>{t.tool}</span>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatCompact(t.tokensSaved)} saved</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Isometric bar chart: daily tokens returned vs saved ─────────────────────
//
// Hand-rolled isometric projection (no 3D library) -- two "runways" of cuboids
// receding into the distance, one per metric (returned, saved), columns = days.
// Standard 2:1 dimetric projection: for grid coords (col, row) and pixel height h,
//   screenX = (col - row) * cosA
//   screenY = (col + row) * sinA - h
// Each cuboid is drawn as 3 quads (top, left, right faces) built from its 8 corners
// projected the same way, each face shaded differently for the 3D look.

const ISO_COS = Math.cos(Math.PI / 6) // 30°
const ISO_SIN = Math.sin(Math.PI / 6)

function isoProject(col: number, row: number, zPixels: number, tile: number): [number, number] {
  return [(col - row) * ISO_COS * tile, (col + row) * ISO_SIN * tile - zPixels]
}

function polyPoints(pts: Array<[number, number]>): string {
  return pts.map(([x, y]) => `${x},${y}`).join(' ')
}

interface IsoCubeProps {
  col: number
  row: number
  heightPixels: number
  tile: number
  cubeWidth: number // fraction of a tile, e.g. 0.7, leaves gaps between cubes
  color: string
}

function IsoCube({ col, row, heightPixels, tile, cubeWidth, color }: IsoCubeProps) {
  if (heightPixels <= 0) return null
  const inset = (1 - cubeWidth) / 2
  const x0 = col + inset, x1 = col + 1 - inset
  const y0 = row + inset, y1 = row + 1 - inset

  const b0 = isoProject(x0, y0, 0, tile)
  const b2 = isoProject(x1, y1, 0, tile), b3 = isoProject(x0, y1, 0, tile)
  const t0 = isoProject(x0, y0, heightPixels, tile), t1 = isoProject(x1, y0, heightPixels, tile)
  const t2 = isoProject(x1, y1, heightPixels, tile), t3 = isoProject(x0, y1, heightPixels, tile)

  return (
    <g>
      <polygon points={polyPoints([b3, b2, t2, t3])} fill={color} opacity={0.65} />
      <polygon points={polyPoints([b0, b3, t3, t0])} fill={color} opacity={0.85} />
      <polygon points={polyPoints([t0, t1, t2, t3])} fill={color} />
      <title>{heightPixels.toFixed(0)}</title>
    </g>
  )
}

function DailyIsoChart({ daily }: { daily: DailyUsage[] }) {
  const width = 560
  const height = 220
  const tile = daily.length > 0 ? Math.min(28, Math.max(12, 260 / daily.length)) : 28
  const maxHeightPixels = 90

  const maxValue = useMemo(() => d3.max(daily, d => Math.max(d.tokensReturned, d.tokensSaved)) ?? 0, [daily])
  const heightScale = useMemo(() => d3.scaleLinear().domain([0, maxValue || 1]).range([0, maxHeightPixels]), [maxValue])

  if (daily.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1" style={{ width, height, color: 'var(--text-muted)' }}>
        <p className="text-[11px]">No daily history yet</p>
        <p className="text-[10px]">Usage starts accumulating per-day from today's calls onward</p>
      </div>
    )
  }

  // Origin placed so the whole receding grid (2 rows deep, daily.length columns wide) fits in view.
  const originX = width / 2 - ((daily.length - 1) - 1) * ISO_COS * tile / 2
  const originY = height - maxHeightPixels - 24

  return (
    <svg width={width} height={height}>
      <g transform={`translate(${originX},${originY})`}>
        {/* Saved (row 1, further back) drawn first so nearer cubes overlap it correctly */}
        {daily.map((d, i) => (
          <IsoCube key={`saved-${d.date}`} col={i} row={1} heightPixels={heightScale(d.tokensSaved)} tile={tile} cubeWidth={0.72} color="#4ade80" />
        ))}
        {daily.map((d, i) => (
          <IsoCube key={`returned-${d.date}`} col={i} row={0} heightPixels={heightScale(d.tokensReturned)} tile={tile} cubeWidth={0.72} color="#7c6cf6" />
        ))}
        {/* Base grid line for the front row */}
        <line
          x1={isoProject(-0.3, 0, 0, tile)[0]} y1={isoProject(-0.3, 0, 0, tile)[1]}
          x2={isoProject(daily.length - 0.7, 0, 0, tile)[0]} y2={isoProject(daily.length - 0.7, 0, 0, tile)[1]}
          stroke="var(--border)" strokeWidth={1}
        />
      </g>
    </svg>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────

export function UsageView() {
  const selectedWorkspace = useFleetStore(s => s.selectedWorkspace)
  const { data: summary, isLoading, error } = useUsageStats(selectedWorkspace)

  if (!selectedWorkspace) {
    return (
      <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--text-muted)' }}>
        Select a workspace from the sidebar to see its usage stats
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
        <RefreshCw size={14} className="animate-spin" />
        Loading usage stats…
      </div>
    )
  }

  if (error || !summary) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2" style={{ color: 'var(--text-muted)' }}>
        <AlertTriangle size={28} style={{ opacity: 0.3 }} />
        <p className="text-sm">Couldn't load usage stats</p>
      </div>
    )
  }

  return (
    <div className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--bg-void)' }}>
      <div className="flex items-center gap-2 mb-4">
        <Zap size={16} style={{ color: 'var(--accent)' }} />
        <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Usage</h1>
        {summary.since && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>since {relTime(summary.since)}</span>
        )}
      </div>

      {summary.totalCalls === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No ctxhub tool usage recorded yet</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Stats accumulate as search/context_pack/open_chunk/get_file_context/architecture tools are called</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-5 gap-3 mb-5">
            <StatCard label="Tool Calls" value={formatCompact(summary.totalCalls)} />
            <StatCard label="Tokens Returned" value={formatCompact(summary.tokensReturned)} />
            <StatCard label="Tokens Saved" value={formatCompact(summary.tokensSaved)} sub={`${summary.savingsPercent}% savings`} />
            <StatCard label="Full-Read Baseline" value={formatCompact(summary.tokensBaseline)} sub="est. if reading files whole" />
            <StatCard label="Tools Used" value={String(summary.tools.length)} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-md" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <p className="text-[10px] uppercase tracking-wide mb-3" style={{ color: 'var(--text-muted)' }}>Savings by tool</p>
              <ToolsDonut tools={summary.tools} />
            </div>
            <div className="p-3 rounded-md overflow-x-auto" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>
                Tokens returned <span style={{ color: '#7c6cf6' }}>■</span> vs saved <span style={{ color: '#4ade80' }}>■</span> per day
              </p>
              <DailyIsoChart daily={summary.daily} />
            </div>
          </div>

          <p className="text-[10px] mt-4" style={{ color: 'var(--text-muted)' }}>
            Heuristic estimate (chars/4), assuming the alternative was reading each matched file in full — a directional signal, not exact accounting.
          </p>
        </>
      )}
    </div>
  )
}
