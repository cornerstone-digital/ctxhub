import { Network, Crosshair, ZoomIn, ZoomOut, Snowflake } from 'lucide-react'
import { useFleetStore } from '../store/fleet'

interface GraphToolbarProps {
  onFit: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}

export function GraphToolbar({ onFit, onZoomIn, onZoomOut }: GraphToolbarProps) {
  const { frozen, toggleFrozen } = useFleetStore()

  const btnBase = {
    background: 'transparent',
    border: 'none',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    transition: 'all 0.15s',
  }

  return (
    <div
      className="absolute flex items-center gap-1 px-2 py-1.5 rounded-full glass"
      style={{
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
      }}
    >
      {/* Graph label */}
      <div className="flex items-center gap-1.5 px-2">
        <Network size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
          Graph
        </span>
      </div>

      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

      <ToolBtn icon={<Crosshair size={13} />} title="Fit all" onClick={onFit} />
      <ToolBtn icon={<ZoomIn size={13} />} title="Zoom in" onClick={onZoomIn} />
      <ToolBtn icon={<ZoomOut size={13} />} title="Zoom out" onClick={onZoomOut} />

      <div style={{ width: 1, height: 20, background: 'var(--border)' }} />

      <button
        title={frozen ? 'Unfreeze simulation' : 'Freeze simulation'}
        onClick={toggleFrozen}
        style={{
          ...btnBase,
          color: frozen ? 'var(--accent)' : 'var(--text-secondary)',
          background: frozen ? 'var(--accent-dim)' : 'transparent',
        }}
        onMouseEnter={e => {
          if (!frozen) (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'
        }}
        onMouseLeave={e => {
          if (!frozen) (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'
        }}
      >
        <Snowflake size={13} />
      </button>
    </div>
  )
}

function ToolBtn({
  icon,
  title,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  onClick: () => void
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        width: 32,
        height: 32,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 6,
        transition: 'all 0.15s',
      }}
      onMouseEnter={e => {
        (e.currentTarget as HTMLElement).style.color = 'var(--text-primary)'
        ;(e.currentTarget as HTMLElement).style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLElement).style.color = 'var(--text-secondary)'
        ;(e.currentTarget as HTMLElement).style.background = 'transparent'
      }}
    >
      {icon}
    </button>
  )
}
