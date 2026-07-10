import { Activity } from 'lucide-react'
import { useFleetStore } from '../store/fleet'
import { healthColor, relTime } from '../lib/utils'

const HIGHLIGHT = /\b(workspace|ctxhub|error|success|failed)\b/gi

// Plain React nodes, not dangerouslySetInnerHTML -- event text can echo back workspace/repo
// names and error messages that ultimately come from indexed repo content, so it must never be
// interpreted as HTML.
function highlighted(text: string) {
  return text.split(HIGHLIGHT).map((part, i) =>
    HIGHLIGHT.test(part) && /^(workspace|ctxhub|error|success|failed)$/i.test(part) ? (
      <strong key={i} style={{ color: 'var(--text-primary)' }}>
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  )
}

export function EventLog() {
  const { activity, setSelectedEvent, selectedEvent } = useFleetStore()

  return (
    <div
      className="flex flex-col border-t overflow-hidden"
      style={{
        height: 176,
        background: 'var(--bg-base)',
        borderColor: 'var(--border)',
        gridArea: 'activity',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-5 py-2 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <Activity size={13} style={{ color: 'var(--accent)' }} />
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          Event Log
        </span>
        <span
          className="text-[10px] px-1.5 py-0.5 rounded-full ml-1"
          style={{
            background: 'rgba(124,110,245,0.15)',
            color: 'var(--accent)',
          }}
        >
          Live
        </span>
        {/* Live indicator */}
        <div className="flex items-center gap-1 ml-auto">
          <span
            className="w-1.5 h-1.5 rounded-full health-dot-pulse"
            style={{ background: 'var(--health-ok)' }}
          />
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {activity.length} events
          </span>
        </div>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
        {activity.length === 0 && (
          <p className="text-xs py-2" style={{ color: 'var(--text-muted)' }}>
            No events yet — indexing, Captain runs, and workspace activity will stream in here.
          </p>
        )}
        {activity.map(event => {
          const color =
            event.type === 'info'
              ? 'var(--accent)'
              : healthColor(event.type === 'ok' ? 'ok' : event.type === 'warn' ? 'warn' : 'error')
          const inspectable = Boolean(event.raw)
          const isSelected = event.raw && selectedEvent?.id === event.raw.id

          return (
            <button
              key={event.id}
              type="button"
              onClick={() => inspectable && setSelectedEvent(event.raw!)}
              className="w-full flex items-baseline gap-2.5 text-xs animate-slide-in-up text-left rounded px-1 -mx-1"
              style={{
                cursor: inspectable ? 'pointer' : 'default',
                background: isSelected ? 'var(--accent-dim)' : 'transparent',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1"
                style={{ background: color }}
              />
              <span className="flex-1 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {highlighted(event.text)}
              </span>
              {event.raw && (
                <span
                  className="text-[9px] font-mono px-1 rounded flex-shrink-0"
                  style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}
                >
                  {event.raw.type}
                </span>
              )}
              <span
                className="text-[10px] flex-shrink-0 font-mono"
                style={{ color: 'var(--text-muted)' }}
              >
                {relTime(event.timestamp)}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
