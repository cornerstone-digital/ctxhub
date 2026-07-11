import { useState } from 'react'
import { CheckCircle, XCircle, AlertTriangle, RefreshCw } from 'lucide-react'
import { useLatestEval } from '../api/client'
import { useFleetStore } from '../store/fleet'
import type { EvalCaseResult } from '../types'

// ── Pass/fail bar ──────────────────────────────────────────────────────────

function SummaryBar({ passed, failed, total }: { passed: number; failed: number; total: number }) {
  const passRatio = total > 0 ? (passed / total) * 100 : 0
  const failRatio = total > 0 ? (failed / total) * 100 : 0

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color: passed === total ? 'var(--health-ok)' : 'var(--health-error)' }}>
          {passed}/{total}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>passed</span>
        {failed > 0 && (
          <span style={{ fontSize: 12, color: 'var(--health-error)', marginLeft: 4 }}>
            · {failed} failing
          </span>
        )}
      </div>
      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-elevated)', overflow: 'hidden', display: 'flex' }}>
        <div style={{ width: `${passRatio}%`, background: 'var(--health-ok)', transition: 'width 0.4s' }} />
        <div style={{ width: `${failRatio}%`, background: 'var(--health-error)', transition: 'width 0.4s' }} />
      </div>
    </div>
  )
}

// ── Case row ───────────────────────────────────────────────────────────────

function CaseRow({ c, selected, onClick }: { c: EvalCaseResult; selected: boolean; onClick: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 10,
        padding: '9px 12px',
        background: selected ? 'rgba(124,110,245,0.1)' : 'transparent',
        border: `1px solid ${selected ? 'rgba(124,110,245,0.4)' : 'transparent'}`,
        borderRadius: 5,
        cursor: 'pointer',
        marginBottom: 2,
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ flexShrink: 0, marginTop: 1 }}>
        {c.passed
          ? <CheckCircle size={13} style={{ color: 'var(--health-ok)' }} />
          : <XCircle size={13} style={{ color: 'var(--health-error)' }} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 500, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {c.query}
        </div>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          {c.expected.length} expected · {c.topResults.length} retrieved
          {c.missing.length > 0 && (
            <span style={{ color: 'var(--health-error)', marginLeft: 6 }}>
              · {c.missing.length} missing
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Case detail panel ──────────────────────────────────────────────────────

function CaseDetail({ c }: { c: EvalCaseResult }) {
  return (
    <div style={{ padding: '16px 18px', overflowY: 'auto', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        {c.passed
          ? <CheckCircle size={14} style={{ color: 'var(--health-ok)' }} />
          : <XCircle size={14} style={{ color: 'var(--health-error)' }} />}
        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>
          {c.passed ? 'Pass' : 'Fail'}
        </span>
      </div>

      <section style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Query</div>
        <div style={{
          background: 'var(--bg-void)', border: '1px solid rgba(255,255,255,0.06)',
          borderRadius: 5, padding: '8px 10px', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6,
        }}>
          {c.query}
        </div>
      </section>

      {c.missing.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--health-error)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Missing ({c.missing.length})
          </div>
          {c.missing.map((m, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--health-error)', fontFamily: 'monospace', marginBottom: 3 }}>
              {m.repo ?? '*'}:{m.path ?? '*'}
            </div>
          ))}
        </section>
      )}

      {c.expected.length > 0 && (
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Expected ({c.expected.length})
          </div>
          {c.expected.map((e, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, fontSize: 11 }}>
              {e.rank
                ? <CheckCircle size={10} style={{ color: 'var(--health-ok)', flexShrink: 0 }} />
                : <XCircle size={10} style={{ color: 'var(--health-error)', flexShrink: 0 }} />}
              <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                {e.repo ?? '*'}:{e.path ?? '*'}
              </span>
              {e.rank && (
                <span style={{ fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>
                  rank {e.rank} · score {e.score?.toFixed(3) ?? '—'}
                </span>
              )}
            </div>
          ))}
        </section>
      )}

      {c.topResults.length > 0 && (
        <section>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Top retrieved ({c.topResults.length})
          </div>
          {c.topResults.slice(0, 6).map((r, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 10 }}>
              <span style={{ color: 'var(--text-muted)', width: 14, flexShrink: 0 }}>{i + 1}.</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.repo}:{r.path}
              </span>
              <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{r.score.toFixed(3)}</span>
            </div>
          ))}
        </section>
      )}

      {c.rationale && (
        <div style={{ marginTop: 16, fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
          {c.rationale}
        </div>
      )}
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────

export function EvalView() {
  const selectedWorkspace = useFleetStore(s => s.selectedWorkspace)
  const [selectedCase, setSelectedCase] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'pass' | 'fail'>('all')

  const { data: evalRun, isLoading, error } = useLatestEval(selectedWorkspace)

  if (!selectedWorkspace) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12 }}>
        Select a workspace from the sidebar to see its eval results
      </div>
    )
  }

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--text-muted)', fontSize: 12 }}>
        <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
        Loading eval results…
      </div>
    )
  }

  if (error || !evalRun) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--text-muted)' }}>
        <AlertTriangle size={28} style={{ opacity: 0.3 }} />
        <div style={{ fontSize: 13 }}>No eval results found</div>
        <div style={{ fontSize: 11, textAlign: 'center', maxWidth: 300, lineHeight: 1.6 }}>
          Run <code style={{ fontFamily: 'monospace', fontSize: 11 }}>ctxhub eval</code> in this workspace to generate results
        </div>
      </div>
    )
  }

  const visibleCases = evalRun.cases.filter(c =>
    filter === 'all' ? true : filter === 'pass' ? c.passed : !c.passed
  )
  const selectedCaseData = selectedCase !== null ? evalRun.cases[selectedCase] : null

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-base)' }}>

      {/* ── Left: case list ──────────────────────────────────────── */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column' }}>

        {/* Header + summary */}
        <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Eval Results
          </div>
          <SummaryBar
            passed={evalRun.summary.passed}
            failed={evalRun.summary.failed}
            total={evalRun.summary.total}
          />
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 10 }}>
            Run {new Date(evalRun.generatedAt).toLocaleString()}
          </div>
          {/* Filter tabs */}
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'pass', 'fail'] as const).map(f => (
              <button
                key={f}
                onClick={() => { setFilter(f); setSelectedCase(null) }}
                style={{
                  flex: 1, padding: '3px 0', fontSize: 10, fontWeight: 500, borderRadius: 4,
                  border: 'none', cursor: 'pointer',
                  background: filter === f ? 'rgba(124,110,245,0.2)' : 'var(--bg-elevated)',
                  color: filter === f ? 'var(--accent)' : 'var(--text-muted)',
                  transition: 'background 0.12s',
                }}
              >
                {f === 'all' ? `All (${evalRun.summary.total})`
                  : f === 'pass' ? `Pass (${evalRun.summary.passed})`
                  : `Fail (${evalRun.summary.failed})`}
              </button>
            ))}
          </div>
        </div>

        {/* Case list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {visibleCases.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24 }}>
              No cases match this filter
            </div>
          ) : (
            visibleCases.map((c) => {
              const origIndex = evalRun.cases.indexOf(c)
              return (
                <CaseRow
                  key={origIndex}
                  c={c}
                  selected={selectedCase === origIndex}
                  onClick={() => setSelectedCase(selectedCase === origIndex ? null : origIndex)}
                />
              )
            })
          )}
        </div>
      </div>

      {/* ── Right: case detail ───────────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {selectedCaseData ? (
          <CaseDetail c={selectedCaseData} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12 }}>
            Click a case to see retrieved results and missing expectations
          </div>
        )}
      </div>

    </div>
  )
}
