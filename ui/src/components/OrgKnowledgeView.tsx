import { useState } from 'react'
import { Globe, Search, AlertTriangle } from 'lucide-react'
import { useOrgKnowledge, useOrgKnowledgeObject } from '../api/client'
import { relTime } from '../lib/utils'
import type { KnowledgeObjectState } from '../types'

const STATE_OPTIONS: Array<{ label: string; value: KnowledgeObjectState | '' }> = [
  { label: 'All states', value: '' },
  { label: 'Active', value: 'active' },
  { label: 'Draft', value: 'draft' },
  { label: 'Superseded', value: 'superseded' },
  { label: 'Archived', value: 'archived' },
]

function stateColor(state: KnowledgeObjectState): string {
  switch (state) {
    case 'active': return 'var(--health-ok)'
    case 'draft': return 'var(--text-muted)'
    case 'superseded': return 'var(--accent)'
    case 'archived': return 'var(--text-muted)'
  }
}

export function OrgKnowledgeView() {
  const [query, setQuery] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [state, setState] = useState<KnowledgeObjectState | ''>('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const { data, isLoading } = useOrgKnowledge({ q: query || undefined, workspace: workspace || undefined, state: state || undefined })
  const { data: detail } = useOrgKnowledgeObject(selectedId)

  const notConfigured = !isLoading && data && !data.configured

  return (
    <div className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--bg-void)' }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Globe size={16} style={{ color: 'var(--accent)' }} />
          <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Org Knowledge
          </h1>
          {data && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              ({data.count})
            </span>
          )}
        </div>

        {!notConfigured && (
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px' }}>
              <Search size={12} style={{ color: 'var(--text-muted)' }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search title, body..."
                className="text-xs w-48"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none' }}
              />
            </div>
            <input
              value={workspace}
              onChange={e => setWorkspace(e.target.value)}
              placeholder="workspace"
              className="text-xs w-32 px-2 py-1.5 rounded-md"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
            />
            <select
              value={state}
              onChange={e => setState(e.target.value as KnowledgeObjectState | '')}
              className="text-xs px-2 py-1.5 rounded-md"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            >
              {STATE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {notConfigured && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-2xl">🌐</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Cloud sync not configured</p>
          <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            ctxhub cloud configure --endpoint &lt;url&gt; --api-key &lt;key&gt;
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Promote findings locally with `ctxhub knowledge promote`, then `ctxhub cloud sync` to see them here.
          </p>
        </div>
      )}

      {!notConfigured && isLoading && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      )}

      {!notConfigured && !isLoading && data?.objects.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {query || workspace || state ? 'No findings match your filters' : 'No findings synced from any workspace yet'}
          </p>
          <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>ctxhub knowledge promote &lt;id&gt; &amp;&amp; ctxhub cloud sync</p>
        </div>
      )}

      <div className="flex gap-4">
        <div className="space-y-2 flex-1 min-w-0">
          {data?.objects.map(obj => (
            <button
              key={obj.id}
              onClick={() => setSelectedId(obj.id === selectedId ? null : obj.id)}
              className="w-full text-left p-3 rounded-md block"
              style={{
                background: obj.id === selectedId ? 'var(--accent-dim)' : 'var(--bg-surface)',
                border: `1px solid ${obj.id === selectedId ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                      {obj.title}
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: stateColor(obj.state), background: 'var(--bg-elevated)' }}>
                      {obj.state}
                    </span>
                    {obj.reviewFlag && (
                      <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--health-warn)', background: 'var(--bg-elevated)' }}>
                        <AlertTriangle size={10} /> needs review
                      </span>
                    )}
                  </div>
                  <p className="text-xs mt-1 line-clamp-2" style={{ color: 'var(--text-secondary)' }}>
                    {obj.body}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{obj.workspaceId}</span>
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>confidence {(obj.confidence * 100).toFixed(0)}%</span>
                    {obj.corroborations > 0 && (
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{obj.corroborations} corroboration{obj.corroborations !== 1 ? 's' : ''}</span>
                    )}
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>promoted {relTime(obj.promotedAt)}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>

        {selectedId && detail && (
          <div className="w-80 flex-shrink-0 p-3 rounded-md" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>{detail.object.title}</p>
            <p className="text-xs whitespace-pre-wrap mb-3" style={{ color: 'var(--text-secondary)' }}>{detail.object.body}</p>
            {detail.object.query && (
              <p className="text-[10px] font-mono mb-1" style={{ color: 'var(--text-muted)' }}>query: {detail.object.query}</p>
            )}
            {detail.object.agent && (
              <p className="text-[10px] font-mono mb-1" style={{ color: 'var(--text-muted)' }}>agent: {detail.object.agent}</p>
            )}
            <p className="text-[10px] font-mono mb-3" style={{ color: 'var(--text-muted)' }}>promoted by: {detail.object.promotedBy}</p>
            {detail.edges.length > 0 && (
              <>
                <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: 'var(--text-muted)' }}>Edges</p>
                <div className="space-y-1">
                  {detail.edges.map(edge => (
                    <p key={edge.id} className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                      {edge.fromId === detail.object.id ? `${edge.edgeType} →` : `← ${edge.edgeType}`} {(edge.fromId === detail.object.id ? edge.toId : edge.fromId).slice(0, 8)}
                    </p>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
