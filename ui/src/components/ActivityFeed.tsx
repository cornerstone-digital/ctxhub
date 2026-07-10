import { Activity } from 'lucide-react'
import { useFleetStore } from '../store/fleet'
import { healthColor, relTime } from '../lib/utils'

export function ActivityFeed() {
  const { activity } = useFleetStore()

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
          Activity
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
            No activity yet — interact with the graph to see events here.
          </p>
        )}
        {activity.map(event => {
          const color =
            event.type === 'info'
              ? 'var(--accent)'
              : healthColor(event.type === 'ok' ? 'ok' : event.type === 'warn' ? 'warn' : 'error')

          return (
            <div
              key={event.id}
              className="flex items-baseline gap-2.5 text-xs animate-slide-in-up"
            >
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0 mt-1"
                style={{ background: color }}
              />
              <span
                className="flex-1 leading-relaxed"
                style={{ color: 'var(--text-secondary)' }}
                dangerouslySetInnerHTML={{
                  __html: event.text.replace(
                    /\b(workspace|ctxhub|error|success|failed)\b/gi,
                    '<strong style="color:var(--text-primary)">$1</strong>'
                  ),
                }}
              />
              <span
                className="text-[10px] flex-shrink-0 font-mono"
                style={{ color: 'var(--text-muted)' }}
              >
                {relTime(event.timestamp)}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
