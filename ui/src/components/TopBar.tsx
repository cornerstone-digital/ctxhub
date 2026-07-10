import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Hexagon } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { useWorkspaces } from '../api/client'
import { useFleetStore } from '../store/fleet'
import { healthColor } from '../lib/utils'

function LiveClock() {
  const [time, setTime] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
      {time.toLocaleTimeString('en-US', { hour12: false })}
    </span>
  )
}

function FleetPills() {
  const { data: wsData } = useWorkspaces()
  const workspaces = wsData?.workspaces ?? []

  // Simple: show healthy/total since we don't batch all statuses here
  const total = workspaces.length
  const exists = workspaces.filter(w => w.exists).length

  if (total === 0) return null

  return (
    <div className="flex items-center gap-2">
      <Pill color={healthColor('ok')} label={`${exists} online`} />
      {total - exists > 0 && (
        <Pill color={healthColor('error')} label={`${total - exists} offline`} />
      )}
    </div>
  )
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
      style={{
        background: `${color}18`,
        border: `1px solid ${color}40`,
        color,
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {label}
    </div>
  )
}

export function TopBar() {
  const qc = useQueryClient()
  const { addActivity } = useFleetStore()

  const handleRefresh = useCallback(() => {
    void qc.invalidateQueries()
    addActivity('Manual refresh triggered', 'info')
  }, [qc, addActivity])

  return (
    <div
      className="flex items-center justify-between px-5 border-b"
      style={{
        height: 52,
        background: 'var(--bg-base)',
        borderColor: 'var(--border)',
        gridArea: 'topbar',
      }}
    >
      {/* Logo + title */}
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center">
          <Hexagon
            size={28}
            style={{ color: 'var(--accent)' }}
            strokeWidth={1.5}
            fill="rgba(124,110,245,0.15)"
          />
          <span
            className="absolute text-[8px] font-bold"
            style={{ color: 'var(--accent)', fontFamily: 'JetBrains Mono, monospace' }}
          >
            ctx
          </span>
        </div>
        <div className="flex flex-col leading-tight">
          <span className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
            ctxhub
          </span>
          <span className="text-[10px] tracking-wider uppercase" style={{ color: 'var(--text-muted)' }}>
            Mission Control
          </span>
        </div>
      </div>

      {/* Center: fleet health pills */}
      <FleetPills />

      {/* Right: clock + refresh */}
      <div className="flex items-center gap-3">
        <LiveClock />
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            color: 'var(--text-secondary)',
          }}
          onMouseEnter={e => {
            e.currentTarget.style.borderColor = 'var(--accent)'
            e.currentTarget.style.color = 'var(--accent)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = 'var(--border)'
            e.currentTarget.style.color = 'var(--text-secondary)'
          }}
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>
    </div>
  )
}
