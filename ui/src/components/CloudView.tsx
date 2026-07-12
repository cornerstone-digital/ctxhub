import { useState } from 'react'
import { Cloud, RefreshCw, ExternalLink } from 'lucide-react'
import { useCloudStatus, useCloudHistory, useSyncCloudMutation } from '../api/client'
import { relTime } from '../lib/utils'

const HISTORY_TYPE_OPTIONS = [
  { label: 'All', value: 'all' },
  { label: 'Runs', value: 'runs' },
  { label: 'Notes', value: 'notes' },
]

export function CloudView() {
  const [historyType, setHistoryType] = useState('all')
  const { data: status, isLoading: statusLoading } = useCloudStatus()
  const { data: history, isLoading: historyLoading } = useCloudHistory({ limit: 50, type: historyType })
  const syncMutation = useSyncCloudMutation()

  const notConfigured = !statusLoading && status && !status.configured

  return (
    <div className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--bg-void)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Cloud size={16} style={{ color: 'var(--accent)' }} />
          <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Cloud
          </h1>
          {history && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              (source: {history.source})
            </span>
          )}
        </div>

        <button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending || notConfigured === true}
          className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md"
          style={{
            background: 'var(--accent)',
            color: 'white',
            opacity: syncMutation.isPending || notConfigured ? 0.5 : 1,
          }}
        >
          <RefreshCw size={12} className={syncMutation.isPending ? 'animate-spin' : ''} />
          {syncMutation.isPending ? 'Syncing…' : 'Sync Now'}
        </button>
      </div>

      {notConfigured && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-2xl">☁️</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Cloud sync not configured</p>
          <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            ctxhub cloud configure --endpoint &lt;url&gt; --api-key &lt;key&gt;
          </p>
        </div>
      )}

      {status?.configured && (
        <>
          {/* Sync status card */}
          <div
            className="grid grid-cols-4 gap-3 mb-5 p-3 rounded-md"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          >
            <div>
              <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Endpoint</p>
              <p className="text-xs font-mono truncate" style={{ color: 'var(--text-secondary)' }}>{status.endpoint}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Last Sync</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                {status.lastSyncAt ? relTime(status.lastSyncAt) : 'never'}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Chunks Synced</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{status.chunksSynced ?? 0}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Chunks Available</p>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>{status.chunksAvailable ?? 0}</p>
            </div>
          </div>

          {syncMutation.isError && (
            <p className="text-xs mb-3" style={{ color: 'var(--health-error)' }}>
              Sync failed: {(syncMutation.error as Error).message}
            </p>
          )}

          {/* History type filter */}
          <div className="flex items-center gap-1.5 mb-3">
            {HISTORY_TYPE_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setHistoryType(opt.value)}
                className="text-[11px] px-2 py-1 rounded-md"
                style={{
                  background: historyType === opt.value ? 'var(--accent)' : 'var(--bg-surface)',
                  color: historyType === opt.value ? 'white' : 'var(--text-muted)',
                  border: '1px solid var(--border)',
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>

          {historyLoading && (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          )}

          {!historyLoading && (history?.runs.length ?? 0) === 0 && (history?.notes.length ?? 0) === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No synced history yet</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Captain runs and promoted notes synced from any workspace in this org appear here.
              </p>
            </div>
          )}

          {/* Runs */}
          {(historyType === 'all' || historyType === 'runs') && (history?.runs.length ?? 0) > 0 && (
            <div className="mb-5">
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
                Captain Runs
              </p>
              <div className="space-y-1.5">
                {history!.runs.map(run => (
                  <div
                    key={run.id}
                    className="flex items-center justify-between px-3 py-2 rounded-md"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                        {run.taskName} <span style={{ color: 'var(--text-muted)' }}>· {run.workspaceId}</span>
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {run.findingsCount} findings · {run.promotedCount} promoted
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{
                          color: run.status === 'completed' ? 'var(--health-ok)' : run.status === 'failed' ? 'var(--health-error)' : 'var(--health-warn)',
                        }}
                      >
                        {run.status}
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        {relTime(run.startedAt)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          {(historyType === 'all' || historyType === 'notes') && (history?.notes.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
                Promoted Notes
              </p>
              <div className="space-y-1.5">
                {history!.notes.map(note => (
                  <div
                    key={note.id}
                    className="flex items-center justify-between px-3 py-2 rounded-md"
                    style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
                        {note.title} <span style={{ color: 'var(--text-muted)' }}>· {note.workspaceId}</span>
                      </p>
                      <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        promoted by {note.promotedBy} · {note.trustTier}
                      </p>
                    </div>
                    <span className="text-[10px] font-mono flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {relTime(note.promotedAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {history?.source === 'local' && status.configured && (
            <p className="flex items-center gap-1 text-[10px] mt-4" style={{ color: 'var(--text-muted)' }}>
              <ExternalLink size={10} />
              Cloud endpoint unreachable — showing empty local fallback, not cached cloud data.
            </p>
          )}
        </>
      )}
    </div>
  )
}
