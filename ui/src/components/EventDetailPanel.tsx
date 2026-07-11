import { X } from 'lucide-react'
import { useFleetStore } from '../store/fleet'
import { healthColor } from '../lib/utils'
import type { CtxhubEventEnvelope } from '../types'

function fieldsFor(event: CtxhubEventEnvelope): Array<{ label: string; value: string }> {
  switch (event.type) {
    case 'index.started':
      return [{ label: 'Workspace', value: event.workspace }]
    case 'index.progress':
      return [
        { label: 'Workspace', value: event.workspace },
        { label: 'Repo', value: event.repo },
        { label: 'Progress', value: `${event.scanned} / ${event.total}` },
      ]
    case 'index.completed':
      return [
        { label: 'Workspace', value: event.workspace },
        { label: 'Scanned', value: String(event.result.scanned) },
        { label: 'Indexed', value: String(event.result.indexed) },
        { label: 'Skipped', value: String(event.result.skipped) },
        { label: 'Deleted', value: String(event.result.deleted) },
      ]
    case 'index.failed':
      return [
        { label: 'Workspace', value: event.workspace },
        { label: 'Error', value: event.error },
      ]
    case 'captain.run.started':
      return [
        { label: 'Task', value: event.task },
        { label: 'Workspace', value: event.workspace },
      ]
    case 'captain.run.completed':
      return [
        { label: 'Task', value: event.task },
        { label: 'Workspace', value: event.workspace },
        { label: 'Run ID', value: event.runId },
      ]
    case 'captain.run.failed':
      return [
        { label: 'Task', value: event.task },
        { label: 'Workspace', value: event.workspace },
        { label: 'Error', value: event.error },
      ]
    case 'captain.handoff':
      return [
        { label: 'From', value: event.from },
        { label: 'To', value: event.to },
        { label: 'From workspace', value: event.fromWorkspace },
        { label: 'To workspace', value: event.toWorkspace },
      ]
    case 'skills.installed':
      return [
        { label: 'Workspace', value: event.workspace },
        { label: 'Agents', value: event.agents.join(', ') || 'all' },
      ]
    case 'personas.synced':
      return [
        { label: 'Workspace', value: event.workspace },
        { label: 'Agents', value: event.agents.join(', ') || 'all' },
      ]
    case 'job.queued':
      return [{ label: 'Job', value: event.job }, { label: 'Run ID', value: event.jobId }]
    case 'job.started':
      return [{ label: 'Job', value: event.job }, { label: 'Run ID', value: event.jobId }]
    case 'job.step.started':
      return [{ label: 'Job', value: event.job }, { label: 'Step', value: event.step }, { label: 'Run ID', value: event.jobId }]
    case 'job.step.completed':
      return [{ label: 'Job', value: event.job }, { label: 'Step', value: event.step }, { label: 'Run ID', value: event.jobId }]
    case 'job.step.failed':
      return [{ label: 'Job', value: event.job }, { label: 'Step', value: event.step }, { label: 'Error', value: event.error }]
    case 'job.completed':
      return [{ label: 'Job', value: event.job }, { label: 'Run ID', value: event.jobId }]
    case 'job.failed':
      return [{ label: 'Job', value: event.job }, { label: 'Error', value: event.error }]
  }
}

const KIND_BY_TYPE: Record<CtxhubEventEnvelope['type'], 'ok' | 'warn' | 'error'> = {
  'index.started': 'warn',
  'index.progress': 'warn',
  'index.completed': 'ok',
  'index.failed': 'error',
  'captain.run.started': 'warn',
  'captain.run.completed': 'ok',
  'captain.run.failed': 'error',
  'captain.handoff': 'warn',
  'skills.installed': 'ok',
  'personas.synced': 'ok',
  'job.queued': 'warn',
  'job.started': 'warn',
  'job.step.started': 'warn',
  'job.step.completed': 'ok',
  'job.step.failed': 'error',
  'job.completed': 'ok',
  'job.failed': 'error',
}

export function EventDetailPanel() {
  const { selectedEvent, setSelectedEvent } = useFleetStore()
  if (!selectedEvent) return null

  const color = healthColor(KIND_BY_TYPE[selectedEvent.type])

  return (
    <div
      className="absolute right-0 top-0 h-full animate-slide-in-right flex flex-col"
      style={{
        width: 320,
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
          Event
        </span>
        <button
          onClick={() => setSelectedEvent(null)}
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
        <div>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: color }} />
            <h2 className="text-sm font-mono font-semibold" style={{ color: 'var(--text-primary)' }}>
              {selectedEvent.type}
            </h2>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              #{selectedEvent.id}
            </span>
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {new Date(selectedEvent.at).toLocaleTimeString()}
            </span>
          </div>
        </div>

        {/* Parsed fields */}
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
            Fields
          </p>
          <div className="space-y-1.5">
            {fieldsFor(selectedEvent).map(field => (
              <div
                key={field.label}
                className="flex items-start justify-between gap-3 px-3 py-2 rounded-md"
                style={{ background: 'var(--bg-elevated)' }}
              >
                <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {field.label}
                </span>
                <span className="text-xs text-right break-all" style={{ color: 'var(--text-secondary)' }}>
                  {field.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Raw JSON */}
        <div>
          <p className="text-[10px] uppercase tracking-widest font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>
            Raw metadata
          </p>
          <pre
            className="text-[10px] font-mono p-3 rounded-md overflow-x-auto"
            style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            {JSON.stringify(selectedEvent, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  )
}
