import { useState, useEffect } from 'react'
import { CheckCircle, ChevronDown } from 'lucide-react'
import { useWorkspaces, useReviewProfiles, useReviewMutation } from '../api/client'

function fieldStyle() {
  return { background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }
}

// Mirrors `ctxhub review <topic> --as <persona> [--base]` exactly: a topic grounds the same
// context-pack evidence gathering `pr-context`/`handoff` already use, `as` picks a named
// persona (built-in or team-defined in .ctxhub/cache/review-profiles.json), and the review is
// synthesized against the real diff between the current branch and `base`.
export function ReviewView() {
  const { data: wsData } = useWorkspaces()
  const workspaces = wsData?.workspaces ?? []
  const [workspace, setWorkspace] = useState<string | null>(null)
  useEffect(() => {
    if (!workspace && workspaces.length > 0) setWorkspace(workspaces[0].name)
  }, [workspace, workspaces])

  const { data: profilesData } = useReviewProfiles(workspace)
  const profiles = profilesData?.profiles ?? []
  const [persona, setPersona] = useState('')
  useEffect(() => {
    if (!persona && profiles.length > 0) setPersona(profiles[0].name)
  }, [persona, profiles])

  const [topic, setTopic] = useState('')
  const [base, setBase] = useState('origin/main')
  const review = useReviewMutation()

  const submit = () => {
    if (!workspace || !persona || !topic.trim()) return
    review.mutate({ workspace, as: persona, topic: topic.trim(), base: base.trim() || undefined })
  }

  const result = review.data

  return (
    <div className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--bg-void)' }}>
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle size={16} style={{ color: 'var(--accent)' }} />
        <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Review
        </h1>
      </div>

      <div className="rounded-lg p-4 mb-4 space-y-3" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1">
            <ChevronDown size={11} style={{ color: 'var(--text-muted)' }} />
            <select
              value={workspace ?? ''}
              onChange={e => setWorkspace(e.target.value || null)}
              className="flex-1 text-xs rounded-md px-2 py-1.5"
              style={fieldStyle()}
            >
              {workspaces.map(ws => (
                <option key={ws.name} value={ws.name}>
                  {ws.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <ChevronDown size={11} style={{ color: 'var(--text-muted)' }} />
            <select
              value={persona}
              onChange={e => setPersona(e.target.value)}
              className="flex-1 text-xs rounded-md px-2 py-1.5"
              style={fieldStyle()}
            >
              {profiles.length === 0 && <option value="">Loading personas…</option>}
              {profiles.map(p => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.kind})
                </option>
              ))}
            </select>
          </div>
        </div>

        <textarea
          value={topic}
          onChange={e => setTopic(e.target.value)}
          placeholder="What are you reviewing? (grounds the same context-pack evidence explain/pr-context use)"
          rows={2}
          className="w-full text-xs rounded-md px-3 py-2 resize-none"
          style={fieldStyle()}
        />

        <div className="flex items-center gap-2">
          <input
            value={base}
            onChange={e => setBase(e.target.value)}
            placeholder="Base branch (default origin/main)"
            className="flex-1 text-xs rounded-md px-3 py-2"
            style={fieldStyle()}
          />
          <button
            onClick={submit}
            disabled={review.isPending || !workspace || !persona || !topic.trim()}
            className="text-xs font-medium rounded-md px-4 py-2 disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            {review.isPending ? 'Reviewing…' : 'Run review'}
          </button>
        </div>

        {review.isError && (
          <p className="text-xs" style={{ color: 'var(--health-error)' }}>
            {(review.error as Error).message}
          </p>
        )}
      </div>

      {result && (
        <div className="rounded-lg p-4 space-y-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div>
            <h2 className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              Review ({result.persona}): {result.topic}
            </h2>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
              Changed files
            </p>
            {Object.keys(result.changed).length === 0 && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                No changed files against this base.
              </p>
            )}
            {Object.entries(result.changed).map(([repo, files]) => (
              <div key={repo} className="mb-1.5">
                <span className="text-[11px] font-medium" style={{ color: 'var(--accent)' }}>
                  {repo}
                </span>
                <ul className="ml-3 mt-0.5">
                  {files.map(f => (
                    <li key={f} className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
              Findings
            </p>
            {result.findings.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                No findings.
              </p>
            ) : (
              <ul className="space-y-1">
                {result.findings.map((finding, i) => (
                  <li
                    key={i}
                    className="text-[11px] leading-relaxed p-2 rounded-md"
                    style={{ background: 'rgba(245,166,35,0.1)', color: 'var(--text-secondary)' }}
                  >
                    {finding}
                  </li>
                ))}
              </ul>
            )}
            {result.llmNotice && (
              <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)' }}>
                {result.llmNotice}
              </p>
            )}
          </div>

          {result.contextPack.suggestedReadingOrder.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-widest font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
                Suggested context
              </p>
              <ul className="space-y-0.5">
                {result.contextPack.suggestedReadingOrder.map((item, i) => (
                  <li key={i} className="text-[11px] font-mono" style={{ color: 'var(--text-secondary)' }}>
                    {item.repo} {item.filePath}
                    {item.title ? ` — ${item.title}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
