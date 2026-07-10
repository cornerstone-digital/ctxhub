import { useRef, useEffect, useCallback, useState } from 'react'
import * as d3 from 'd3'
import { useWorkspaces, useWorkspaceStatus } from '../api/client'
import { useFleetStore } from '../store/fleet'
import { healthColor } from '../lib/utils'
import { GraphToolbar } from './GraphToolbar'
import { DetailPanel } from './DetailPanel'
import type { Workspace } from '../types'

interface NodeDatum extends d3.SimulationNodeDatum {
  id: string
  workspace: Workspace
  health: 'ok' | 'warn' | 'error' | 'loading'
}

interface LinkDatum extends d3.SimulationLinkDatum<NodeDatum> {
  source: NodeDatum
  target: NodeDatum
}

const NODE_RADIUS = 44
const MINIMAP_W = 140
const MINIMAP_H = 88

// We need a stable health hook per-node — lifted to a wrapper
function NodeHealthFetcher({
  name,
  onHealth,
}: {
  name: string
  onHealth: (name: string, h: 'ok' | 'warn' | 'error' | 'loading') => void
}) {
  const { data, isLoading } = useWorkspaceStatus(name)
  useEffect(() => {
    if (isLoading) {
      onHealth(name, 'loading')
      return
    }
    const checks = data?.checks ?? []
    const h = checks.some(c => c.status === 'error')
      ? 'error'
      : checks.some(c => c.status === 'warn')
      ? 'warn'
      : 'ok'
    onHealth(name, h)
  }, [data, isLoading, name, onHealth])
  return null
}

export function GraphCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const minimapRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<d3.Simulation<NodeDatum, LinkDatum> | null>(null)
  const nodesRef = useRef<NodeDatum[]>([])
  const linksRef = useRef<LinkDatum[]>([])
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity)
  const rafRef = useRef<number>(0)
  const particleRef = useRef({ progress: 0, active: false })
  const zoomBehaviorRef = useRef<d3.ZoomBehavior<HTMLCanvasElement, unknown> | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  const { data: wsData } = useWorkspaces()
  const workspaces = wsData?.workspaces ?? []
  const { selectedWorkspace, setSelectedWorkspace, frozen, addActivity } = useFleetStore()

  const [healthMap, setHealthMap] = useState<Record<string, 'ok' | 'warn' | 'error' | 'loading'>>({})

  const handleHealth = useCallback((name: string, h: 'ok' | 'warn' | 'error' | 'loading') => {
    setHealthMap(prev => {
      if (prev[name] === h) return prev
      return { ...prev, [name]: h }
    })
  }, [])

  // Update nodes when workspaces change
  useEffect(() => {
    const existingById = new Map(nodesRef.current.map(n => [n.id, n]))
    const newNodes: NodeDatum[] = workspaces.map(ws => {
      const existing = existingById.get(ws.name)
      if (existing) {
        existing.workspace = ws
        return existing
      }
      return {
        id: ws.name,
        workspace: ws,
        health: 'loading' as const,
        x: undefined,
        y: undefined,
      }
    })
    nodesRef.current = newNodes

    // Build links: star topology — hub (first node) connects to all others
    const links: LinkDatum[] = []
    if (newNodes.length > 1) {
      for (let i = 1; i < newNodes.length; i++) {
        links.push({ source: newNodes[0], target: newNodes[i] })
      }
    }
    linksRef.current = links

    if (simRef.current) {
      simRef.current.nodes(newNodes)
      const linkForce = simRef.current.force<d3.ForceLink<NodeDatum, LinkDatum>>('link')
      if (linkForce) linkForce.links(links)
      simRef.current.alpha(0.5).restart()
    }
  }, [workspaces])

  // Sync health into nodes
  useEffect(() => {
    nodesRef.current.forEach(n => {
      const h = healthMap[n.id]
      if (h) n.health = h
    })
  }, [healthMap])

  // Stop/restart simulation when frozen changes
  useEffect(() => {
    if (!simRef.current) return
    if (frozen) {
      simRef.current.stop()
    } else {
      simRef.current.alpha(0.3).restart()
    }
  }, [frozen])

  // Particle animation when workspace selected
  useEffect(() => {
    particleRef.current.active = selectedWorkspace !== null
    particleRef.current.progress = 0
  }, [selectedWorkspace])

  // Canvas setup
  useEffect(() => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const W = container.clientWidth
    const H = container.clientHeight
    canvas.width = W
    canvas.height = H

    // Init D3 simulation
    const sim = d3
      .forceSimulation<NodeDatum>(nodesRef.current)
      .force('charge', d3.forceManyBody<NodeDatum>().strength(-350))
      .force(
        'link',
        d3
          .forceLink<NodeDatum, LinkDatum>(linksRef.current)
          .id(d => d.id)
          .distance(180)
      )
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collide', d3.forceCollide<NodeDatum>(NODE_RADIUS + 20))
    simRef.current = sim

    // Zoom
    const zoom = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 3])
      .on('zoom', e => {
        transformRef.current = e.transform as d3.ZoomTransform
      })
    zoomBehaviorRef.current = zoom
    d3.select(canvas).call(zoom)

    // Click detection
    canvas.addEventListener('click', handleCanvasClick)
    canvas.addEventListener('mousemove', handleMouseMove)

    // Render loop
    function drawFrame() {
      const ctx = canvas!.getContext('2d')
      if (!ctx) return

      const w = canvas!.width
      const h = canvas!.height
      ctx.clearRect(0, 0, w, h)

      // --- Background grid dots ---
      const t = transformRef.current
      ctx.save()
      const gridSpacing = 32 * t.k
      const offsetX = ((t.x % gridSpacing) + gridSpacing) % gridSpacing
      const offsetY = ((t.y % gridSpacing) + gridSpacing) % gridSpacing
      const dotR = Math.max(0.5, 0.8 * t.k)
      ctx.fillStyle = 'rgba(90,90,128,0.3)'
      for (let gx = offsetX - gridSpacing; gx < w + gridSpacing; gx += gridSpacing) {
        for (let gy = offsetY - gridSpacing; gy < h + gridSpacing; gy += gridSpacing) {
          ctx.beginPath()
          ctx.arc(gx, gy, dotR, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      ctx.restore()

      ctx.save()
      ctx.translate(t.x, t.y)
      ctx.scale(t.k, t.k)

      const nodes = nodesRef.current
      const links = linksRef.current

      // --- Edges ---
      links.forEach(link => {
        const s = link.source as NodeDatum
        const tgt = link.target as NodeDatum
        if (s.x == null || s.y == null || tgt.x == null || tgt.y == null) return

        const isActive = s.id === selectedWorkspace || tgt.id === selectedWorkspace
        ctx.beginPath()
        ctx.moveTo(s.x, s.y)
        ctx.lineTo(tgt.x, tgt.y)
        ctx.strokeStyle = isActive ? 'rgba(124,110,245,0.5)' : 'rgba(90,90,128,0.25)'
        ctx.lineWidth = isActive ? 1.5 : 1
        ctx.setLineDash(isActive ? [] : [4, 6])
        ctx.stroke()
        ctx.setLineDash([])
      })

      // --- Travel particle ---
      if (particleRef.current.active && selectedWorkspace) {
        particleRef.current.progress = (particleRef.current.progress + 0.008) % 1
        const p = particleRef.current.progress
        // Find a link involving selected node
        const activeLink = links.find(
          l => (l.source as NodeDatum).id === selectedWorkspace || (l.target as NodeDatum).id === selectedWorkspace
        )
        if (activeLink) {
          const s = activeLink.source as NodeDatum
          const tgt = activeLink.target as NodeDatum
          if (s.x != null && s.y != null && tgt.x != null && tgt.y != null) {
            const px = s.x + (tgt.x - s.x) * p
            const py = s.y + (tgt.y - s.y) * p
            const grad = ctx.createRadialGradient(px, py, 0, px, py, 6)
            grad.addColorStop(0, 'rgba(124,110,245,1)')
            grad.addColorStop(1, 'rgba(124,110,245,0)')
            ctx.beginPath()
            ctx.arc(px, py, 6, 0, Math.PI * 2)
            ctx.fillStyle = grad
            ctx.fill()
          }
        }
      }

      // --- Nodes ---
      nodes.forEach(node => {
        if (node.x == null || node.y == null) return
        const x = node.x
        const y = node.y
        const isSelected = node.id === selectedWorkspace
        const hColor = node.health === 'loading' ? '#5a5a80' : healthColor(node.health)
        const r = NODE_RADIUS

        // Glow
        if (isSelected || node.health !== 'loading') {
          const glowSize = isSelected ? r + 20 : r + 10
          const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowSize)
          glow.addColorStop(0, `${hColor}30`)
          glow.addColorStop(1, 'transparent')
          ctx.beginPath()
          ctx.arc(x, y, glowSize, 0, Math.PI * 2)
          ctx.fillStyle = glow
          ctx.fill()
        }

        // Body gradient
        const bodyGrad = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r)
        bodyGrad.addColorStop(0, '#1a1a35')
        bodyGrad.addColorStop(1, '#0d0d1a')
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.fillStyle = bodyGrad
        ctx.fill()

        // Health ring
        const ringWidth = isSelected ? 3 : 2
        ctx.beginPath()
        ctx.arc(x, y, r, 0, Math.PI * 2)
        ctx.strokeStyle = hColor
        ctx.lineWidth = ringWidth
        ctx.stroke()

        // Selection outer ring
        if (isSelected) {
          ctx.beginPath()
          ctx.arc(x, y, r + 7, 0, Math.PI * 2)
          ctx.strokeStyle = 'rgba(124,110,245,0.4)'
          ctx.lineWidth = 1
          ctx.stroke()
        }

        // Label
        ctx.font = `500 11px Inter, sans-serif`
        ctx.fillStyle = isSelected ? '#eeeeff' : '#9898c0'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const maxLen = 10
        const label = node.id.length > maxLen ? node.id.slice(0, maxLen - 1) + '…' : node.id
        ctx.fillText(label, x, y)

        // Status dot
        const dotR = 6
        const dotX = x + r * 0.7
        const dotY = y - r * 0.7
        ctx.beginPath()
        ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2)
        ctx.fillStyle = hColor
        ctx.fill()
        ctx.strokeStyle = '#0d0d1a'
        ctx.lineWidth = 1.5
        ctx.stroke()
      })

      ctx.restore()

      // --- Minimap ---
      drawMinimap(nodes)

      rafRef.current = requestAnimationFrame(drawFrame)
    }

    rafRef.current = requestAnimationFrame(drawFrame)

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (!canvas || !container) return
      canvas.width = container.clientWidth
      canvas.height = container.clientHeight
    })
    ro.observe(container)

    return () => {
      cancelAnimationFrame(rafRef.current)
      sim.stop()
      canvas.removeEventListener('click', handleCanvasClick)
      canvas.removeEventListener('mousemove', handleMouseMove)
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function drawMinimap(nodes: NodeDatum[]) {
    const minimap = minimapRef.current
    if (!minimap) return
    const ctx = minimap.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, MINIMAP_W, MINIMAP_H)

    // Background
    ctx.fillStyle = 'rgba(13,13,26,0.85)'
    ctx.fillRect(0, 0, MINIMAP_W, MINIMAP_H)
    ctx.strokeStyle = 'rgba(124,110,245,0.2)'
    ctx.lineWidth = 1
    ctx.strokeRect(0.5, 0.5, MINIMAP_W - 1, MINIMAP_H - 1)

    if (nodes.length === 0) return

    const xs = nodes.filter(n => n.x != null).map(n => n.x!)
    const ys = nodes.filter(n => n.y != null).map(n => n.y!)
    if (xs.length === 0) return

    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const pad = 16

    const scaleX = (MINIMAP_W - pad * 2) / Math.max(maxX - minX, 1)
    const scaleY = (MINIMAP_H - pad * 2) / Math.max(maxY - minY, 1)
    const scale = Math.min(scaleX, scaleY, 0.3)

    nodes.forEach(node => {
      if (node.x == null || node.y == null) return
      const mx = pad + (node.x - minX) * scale
      const my = pad + (node.y - minY) * scale
      const hColor = node.health === 'loading' ? '#5a5a80' : healthColor(node.health)
      ctx.beginPath()
      ctx.arc(mx, my, 4, 0, Math.PI * 2)
      ctx.fillStyle = hColor
      ctx.fill()
    })
  }

  function screenToWorld(sx: number, sy: number) {
    const t = transformRef.current
    return {
      x: (sx - t.x) / t.k,
      y: (sy - t.y) / t.k,
    }
  }

  function hitTest(sx: number, sy: number): NodeDatum | null {
    const { x, y } = screenToWorld(sx, sy)
    const t = transformRef.current
    const threshold = NODE_RADIUS / t.k + 4
    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue
      const dx = node.x - x
      const dy = node.y - y
      if (Math.sqrt(dx * dx + dy * dy) < threshold) return node
    }
    return null
  }

  function handleCanvasClick(e: MouseEvent) {
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (hit) {
      setSelectedWorkspace(hit.id === selectedWorkspace ? null : hit.id)
      if (hit.id !== selectedWorkspace) {
        addActivity(`Selected workspace: ${hit.id}`, 'info')
      }
    } else {
      setSelectedWorkspace(null)
    }
  }

  function handleMouseMove(e: MouseEvent) {
    const canvas = canvasRef.current
    const tooltip = tooltipRef.current
    if (!canvas || !tooltip) return
    const rect = canvas.getBoundingClientRect()
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top)
    if (hit) {
      canvas.style.cursor = 'pointer'
      tooltip.style.display = 'block'
      tooltip.style.left = `${e.clientX - rect.left + 12}px`
      tooltip.style.top = `${e.clientY - rect.top - 8}px`
      tooltip.innerHTML = `<strong>${hit.id}</strong><br/><span style="color:var(--text-muted)">${hit.workspace.path.replace(/^\/Users\/[^/]+/, '~')}</span>`
    } else {
      canvas.style.cursor = 'grab'
      tooltip.style.display = 'none'
    }
  }

  const handleFit = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !zoomBehaviorRef.current) return
    const nodes = nodesRef.current.filter(n => n.x != null && n.y != null)
    if (nodes.length === 0) return
    const W = canvas.width
    const H = canvas.height
    const xs = nodes.map(n => n.x!)
    const ys = nodes.map(n => n.y!)
    const x0 = Math.min(...xs) - NODE_RADIUS
    const y0 = Math.min(...ys) - NODE_RADIUS
    const x1 = Math.max(...xs) + NODE_RADIUS
    const y1 = Math.max(...ys) + NODE_RADIUS
    d3.select(canvas)
      .transition()
      .duration(400)
      .call(
        zoomBehaviorRef.current.transform,
        d3.zoomIdentity
          .translate(W / 2, H / 2)
          .scale(Math.min(0.9, 0.9 / Math.max((x1 - x0) / W, (y1 - y0) / H)))
          .translate(-(x0 + x1) / 2, -(y0 + y1) / 2)
      )
  }, [])

  const handleZoomIn = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !zoomBehaviorRef.current) return
    d3.select(canvas).transition().duration(200).call(zoomBehaviorRef.current.scaleBy, 1.5)
  }, [])

  const handleZoomOut = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !zoomBehaviorRef.current) return
    d3.select(canvas).transition().duration(200).call(zoomBehaviorRef.current.scaleBy, 1 / 1.5)
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden"
      style={{ background: 'var(--bg-void)', gridArea: 'main' }}
    >
      {/* Background canvas */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ cursor: 'grab' }}
      />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        className="absolute pointer-events-none px-2.5 py-1.5 rounded-lg text-xs"
        style={{
          display: 'none',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
          zIndex: 50,
          lineHeight: 1.6,
          backdropFilter: 'blur(8px)',
        }}
      />

      {/* Health fetchers (invisible) */}
      {workspaces.map(ws => (
        <NodeHealthFetcher key={ws.name} name={ws.name} onHealth={handleHealth} />
      ))}

      {/* Toolbar */}
      <GraphToolbar onFit={handleFit} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />

      {/* Empty state */}
      {workspaces.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <p className="text-4xl">🛸</p>
          <p className="text-base font-medium" style={{ color: 'var(--text-secondary)' }}>
            No workspaces registered
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Run <code className="font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)' }}>ctxhub add .</code> to add your first workspace
          </p>
        </div>
      )}

      {/* Minimap */}
      <canvas
        ref={minimapRef}
        width={MINIMAP_W}
        height={MINIMAP_H}
        className="absolute rounded-lg"
        style={{
          bottom: 16,
          right: selectedWorkspace ? 292 : 16,
          transition: 'right 0.25s ease',
          opacity: 0.85,
        }}
      />

      {/* Detail panel */}
      <DetailPanel />
    </div>
  )
}
