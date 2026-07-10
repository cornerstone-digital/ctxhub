import { X, CheckCircle, AlertTriangle, XCircle, MessageSquare, RefreshCw, Folder } from 'lucide-react'
import { useWorkspaceStatus } from '../api/client'
import { useFleetStore } from '../store/fleet'

export function DetailPanel() {
  const { selectedWorkspace, setSelectedWorkspace, setChatWorkspace } = useFleetStore()
  const { data: status, isLoading, refetch } = useWorkspaceStatus(selectedWorkspace)

  if (!selectedWorkspace) return null

  const checks = status?.checks ?? []

  return (
    <div
      className="absolute right-0 top-0 h-full animate-slide-in-right flex flex-col"
      style={{
        width: 276,
        background: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        zIndex: 20,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Workspace
        </span>
        <button
          onClick={() => setSelectedWorkspace(null)}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-all"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'var(--bg-elevated)'
            e.currentTarget.style.color = 'var(--text-primary)'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent'
            e.currentTarget.style.color = 'var(--text-muted)'
          }}
        >
          <X size={14} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Name + path */}
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            {selectedWorkspace}
          </h2>
          {status?.path && (
            <div className="flex items-center gap-1 mt-1">
              <Folder size={11} style={{ color: 'var(--text-muted)' }} />
              <span
                className="text-[11px] font-mono truncate"
                style={{ color: 'var(--text-muted)' }}
                title={status.path}
              >
                {status.path.replace(/^\/Users\/[^/]+/, '~')}
              </span>
            </div>
          )}
        </div>

        {/* Health checks */}
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
            Health Checks
          </p>
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map(i => (
                <div key={i} className="h-8 rounded-md animate-pulse" style={{ background: 'var(--bg-elevated)' }} />
              ))}
            </div>
          )}
          {!isLoading && checks.length === 0 && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No checks available</p>
          )}
          <div className="space-y-1.5">
            {checks.map((check, i) => {
              const Icon =
                check.status === 'ok'
                  ? CheckCircle
                  : check.status === 'warn'
                  ? AlertTriangle
                  : XCircle
              const color =
                check.status === 'ok'
                  ? 'var(--health-ok)'
                  : check.status === 'warn'
                  ? 'var(--health-warn)'
                  : 'var(--health-error)'
              return (
                <div
                  key={i}
                  className="flex items-start gap-2.5 px-3 py-2 rounded-md"
                  style={{ background: 'var(--bg-elevated)' }}
                >
                  <Icon size={13} style={{ color, flexShrink: 0, marginTop: 1 }} />
                  <span className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                    {check.message}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="px-4 py-3 border-t space-y-2" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => {
            setChatWorkspace(selectedWorkspace)
          }}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-all"
          style={{
            background: 'var(--accent)',
            color: 'white',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
        >
          <MessageSquare size={13} />
          Ask this workspace
        </button>
        <button
          onClick={() => void refetch()}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-md text-xs font-medium transition-all"
          style={{
            background: 'var(--bg-elevated)',
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
          Re-check
        </button>
      </div>
    </div>
  )
}
