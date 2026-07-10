import { Network, Users, BookOpen } from 'lucide-react'
import { useWorkspaces, useHealth, useWorkspaceStatus } from '../api/client'
import { useFleetStore } from '../store/fleet'
import { healthColor } from '../lib/utils'
import type { Workspace } from '../types'

function WorkspaceRow({ ws }: { ws: Workspace }) {
  const { selectedWorkspace, setSelectedWorkspace } = useFleetStore()
  const { data: status, isLoading } = useWorkspaceStatus(ws.name)
  const isSelected = selectedWorkspace === ws.name

  const checks = status?.checks ?? []
  const health = !ws.exists
    ? 'error'
    : checks.some(c => c.status === 'error')
    ? 'error'
    : checks.some(c => c.status === 'warn')
    ? 'warn'
    : checks.length > 0
    ? 'ok'
    : 'ok'

  const color = healthColor(health)
  const shortPath = ws.path.replace(/^\/Users\/[^/]+/, '~')

  return (
    <button
      onClick={() => setSelectedWorkspace(isSelected ? null : ws.name)}
      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-all group"
      style={{
        background: isSelected ? 'var(--accent-dim)' : 'transparent',
        border: `1px solid ${isSelected ? 'var(--accent)' : 'transparent'}`,
      }}
      onMouseEnter={e => {
        if (!isSelected) e.currentTarget.style.background = 'var(--bg-elevated)'
      }}
      onMouseLeave={e => {
        if (!isSelected) e.currentTarget.style.background = 'transparent'
      }}
    >
      {/* Health dot */}
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${isLoading ? 'health-dot-pulse' : ''}`}
        style={{ background: isLoading ? '#5a5a80' : color }}
      />
      {/* Info */}
      <div className="flex flex-col min-w-0 flex-1">
        <span
          className="text-xs font-medium truncate"
          style={{ color: isSelected ? 'var(--accent)' : 'var(--text-primary)' }}
        >
          {ws.name}
        </span>
        <span className="text-[10px] truncate font-mono" style={{ color: 'var(--text-muted)' }}>
          {shortPath}
        </span>
      </div>
    </button>
  )
}

export function Sidebar() {
  const { data: wsData } = useWorkspaces()
  const { data: health } = useHealth()
  const workspaces = wsData?.workspaces ?? []

  const navItems = [
    { icon: Network, label: 'Fleet', active: true, disabled: false },
    { icon: Users, label: 'Captains', active: false, disabled: true, soon: 'Phase 4' },
    { icon: BookOpen, label: 'Knowledge', active: false, disabled: true },
  ]

  return (
    <div
      className="flex flex-col h-full border-r overflow-hidden"
      style={{
        width: 220,
        background: 'var(--bg-base)',
        borderColor: 'var(--border)',
        gridArea: 'sidebar',
      }}
    >
      {/* Nav */}
      <div className="px-3 pt-4 pb-2">
        <p className="text-[10px] uppercase tracking-widest font-semibold px-2 pb-2" style={{ color: 'var(--text-muted)' }}>
          Navigation
        </p>
        {navItems.map(item => (
          <div
            key={item.label}
            className={`flex items-center gap-2.5 px-2 py-1.5 rounded-md mb-0.5 ${
              item.disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
            }`}
            style={{
              background: item.active ? 'var(--accent-dim)' : 'transparent',
              border: `1px solid ${item.active ? 'var(--accent)' : 'transparent'}`,
            }}
          >
            <item.icon
              size={14}
              style={{ color: item.active ? 'var(--accent)' : 'var(--text-secondary)' }}
            />
            <span
              className="text-xs font-medium"
              style={{ color: item.active ? 'var(--accent)' : 'var(--text-secondary)' }}
            >
              {item.label}
            </span>
            {item.soon && (
              <span
                className="ml-auto text-[9px] px-1.5 py-0.5 rounded"
                style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
              >
                {item.soon}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Divider */}
      <div className="mx-3 my-2" style={{ height: 1, background: 'var(--border-subtle)' }} />

      {/* Workspace list */}
      <div className="flex-1 overflow-y-auto px-3">
        <p className="text-[10px] uppercase tracking-widest font-semibold px-2 pb-2" style={{ color: 'var(--text-muted)' }}>
          Workspaces ({workspaces.length})
        </p>
        {workspaces.length === 0 && (
          <p className="px-2 text-xs" style={{ color: 'var(--text-muted)' }}>
            No workspaces registered
          </p>
        )}
        <div className="space-y-0.5">
          {workspaces.map(ws => (
            <WorkspaceRow key={ws.name} ws={ws} />
          ))}
        </div>
      </div>

      {/* Version tag */}
      <div
        className="px-4 py-3 border-t"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
          v{health?.version ?? '—'}
        </span>
      </div>
    </div>
  )
}
