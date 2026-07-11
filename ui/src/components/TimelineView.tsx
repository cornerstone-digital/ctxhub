import { useState } from 'react'
import { Activity } from 'lucide-react'
import { useEventHistory } from '../api/client'
import { relTime } from '../lib/utils'
import type { CtxhubEventEnvelope } from '../types'

// Colour-coded dot for each event category
function eventDot(type: string): string {
  if (type.startsWith('captain.run.completed') || type === 'captain.run.promoted') return 'var(--health-ok)'
  if (type.startsWith('captain.run.failed') || type.startsWith('job.failed') || type.startsWith('job.step.failed')) return 'var(--health-error)'
  if (type.startsWith('index.completed')) return 'var(--accent)'
  if (type.startsWith('job.completed')) return 'var(--health-ok)'
  if (type.startsWith('captain') || type.startsWith('job') || type.startsWith('index')) return 'var(--health-warn)'
  return 'var(--text-muted)'
}

function eventLabel(ev: CtxhubEventEnvelope): string {
  switch (ev.type) {
    case 'captain.run.started':    return `Captain "${ev.task}" started`
    case 'captain.run.completed':  return `Captain "${ev.task}" completed (run ${ev.runId.slice(-8)})`
    case 'captain.run.failed':     return `Captain "${ev.task}" failed: ${ev.error}`
    case 'captain.run.promoted':   return `Captain "${ev.task}" run promoted → ${ev.notePath.split('/').slice(-1)[0]}`
    case 'captain.handoff':        return `Handoff "${ev.from}" → "${ev.to}"`
    case 'index.started':          return `Index started (${ev.workspace})`
    case 'index.completed':        return `Index completed (${ev.workspace})`
    case 'index.failed':           return `Index failed (${ev.workspace}): ${ev.error}`
    case 'job.queued':             return `Job "${ev.job}" queued`
    case 'job.started':            return `Job "${ev.job}" started`
    case 'job.completed':          return `Job "${ev.job}" completed`
    case 'job.failed':             return `Job "${ev.job}" failed: ${ev.error}`
    case 'job.step.started':       return `  Step "${ev.step}" started`
    case 'job.step.completed':     return `  Step "${ev.step}" completed`
    case 'job.step.failed':        return `  Step "${ev.step}" failed: ${ev.error}`
    case 'skills.installed':       return `Skills installed (${ev.workspace})`
    case 'personas.synced':        return `Personas synced (${ev.workspace})`
    default:                       return ev.type
  }
}

// Noise events that clutter the timeline — show only on request
const NOISY_TYPES = new Set(['index.progress', 'job.queued'])

const TYPE_FILTER_OPTIONS = [
  { label: 'All', value: '' },
  { label: 'Captains', value: 'captain' },
  { label: 'Jobs', value: 'job' },
  { label: 'Index', value: 'index' },
  { label: 'Promotions', value: 'captain.run.promoted' },
]

export function TimelineView() {
  const [typeFilter, setTypeFilter] = useState('')
  const [limit, setLimit] = useState(100)

  const types = typeFilter ? [typeFilter] : undefined
  const { data, isLoading } = useEventHistory({ limit, types })
  const allEvents = (data?.events ?? []).filter((e: CtxhubEventEnvelope) => !NOISY_TYPES.has(e.type))

  // Group by date for visual separation
  const grouped: Array<{ date: string; events: CtxhubEventEnvelope[] }> = []
  for (const ev of allEvents) {
    const date = ev.at.slice(0, 10)
    const last = grouped[grouped.length - 1]
    if (last?.date === date) {
      last.events.push(ev)
    } else {
      grouped.push({ date, events: [ev] })
    }
  }

  return (
    <div className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--bg-void)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Activity size={16} style={{ color: 'var(--accent)' }} />
          <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Timeline
          </h1>
          {data && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              ({data.count} events)
            </span>
          )}
        </div>

        {/* Type filter */}
        <div className="flex items-center gap-1.5">
          {TYPE_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setTypeFilter(opt.value)}
              className="text-[11px] px-2 py-1 rounded-md"
              style={{
                background: typeFilter === opt.value ? 'var(--accent)' : 'var(--bg-surface)',
                color: typeFilter === opt.value ? 'white' : 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      )}

      {!isLoading && allEvents.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-2xl">📋</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No events recorded yet</p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Events appear here as captain runs, jobs, and index operations complete.
          </p>
        </div>
      )}

      {/* Timeline */}
      <div className="space-y-4">
        {grouped.map(group => (
          <div key={group.date}>
            <p
              className="text-[10px] uppercase tracking-widest font-semibold mb-2 sticky top-0 py-1"
              style={{ color: 'var(--text-muted)', background: 'var(--bg-void)' }}
            >
              {group.date}
            </p>
            <div className="relative ml-3">
              {/* Vertical line */}
              <div
                className="absolute left-0 top-0 bottom-0 w-px"
                style={{ background: 'var(--border-subtle)' }}
              />
              <div className="space-y-0">
                {group.events.map(ev => (
                  <div key={ev.id} className="flex items-start gap-3 py-1.5 pl-4 relative">
                    {/* Dot */}
                    <div
                      className="absolute left-0 top-2.5 w-2 h-2 rounded-full -translate-x-1/2 flex-shrink-0"
                      style={{ background: eventDot(ev.type) }}
                    />
                    <div className="flex-1 min-w-0">
                      <span className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                        {eventLabel(ev)}
                      </span>
                    </div>
                    <span className="text-[10px] font-mono flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                      {relTime(ev.at)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Load more */}
      {(data?.count ?? 0) >= limit && (
        <button
          onClick={() => setLimit(l => l + 100)}
          className="w-full text-[11px] py-3 mt-4 text-center rounded-md"
          style={{ color: 'var(--text-muted)', background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
        >
          Load 100 more events
        </button>
      )}
    </div>
  )
}
