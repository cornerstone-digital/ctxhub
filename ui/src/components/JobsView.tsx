import { useState } from 'react'
import { RefreshCw, CheckCircle, XCircle, AlertTriangle, X } from 'lucide-react'
import { useJobs, useJobRuns, useRunJobMutation, useDeleteJobMutation, useJobRun } from '../api/client'
import { useFleetStore } from '../store/fleet'
import type { JobDefinition, JobRun, JobStepRun } from '../types'

// ── Utility helpers ────────────────────────────────────────────────────────

function elapsed(start?: string, end?: string): string {
  if (!start) return ''
  const ms = new Date(end ?? Date.now()).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function StatusIcon({ status }: { status: string }) {
  if (status === 'completed') return <CheckCircle size={13} style={{ color: 'var(--health-ok)', flexShrink: 0 }} />
  if (status === 'failed')    return <XCircle size={13} style={{ color: 'var(--health-error)', flexShrink: 0 }} />
  if (status === 'running')   return <RefreshCw size={13} style={{ color: 'var(--accent)', flexShrink: 0, animation: 'spin 1s linear infinite' }} />
  if (status === 'queued')    return <AlertTriangle size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
  return <AlertTriangle size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
}

function statusColor(status: string): string {
  if (status === 'completed') return 'var(--health-ok)'
  if (status === 'failed')    return 'var(--health-error)'
  if (status === 'running')   return 'var(--accent)'
  if (status === 'queued')    return 'var(--text-muted)'
  return 'var(--text-muted)'
}

// ── Job list sidebar ───────────────────────────────────────────────────────

function JobListItem({
  job,
  lastRun,
  selected,
  onClick,
}: {
  job: JobDefinition
  lastRun?: JobRun
  selected: boolean
  onClick: () => void
}) {
  const runMutation = useRunJobMutation()
  const deleteMutation = useDeleteJobMutation()

  return (
    <div
      onClick={onClick}
      style={{
        padding: '10px 12px',
        background: selected ? 'rgba(124,110,245,0.12)' : 'transparent',
        border: `1px solid ${selected ? 'rgba(124,110,245,0.4)' : 'transparent'}`,
        borderRadius: 6,
        cursor: 'pointer',
        marginBottom: 4,
        transition: 'background 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-elevated)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
        {lastRun ? <StatusIcon status={lastRun.status} /> : <AlertTriangle size={13} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {job.name}
        </span>
        <button
          onClick={e => { e.stopPropagation(); runMutation.mutate(job.name) }}
          disabled={runMutation.isPending}
          title="Run now"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 2,
            color: 'var(--accent)', opacity: runMutation.isPending ? 0.4 : 1,
            display: 'flex', alignItems: 'center',
          }}
        >
          <RefreshCw size={11} />
        </button>
        <button
          onClick={e => { e.stopPropagation(); if (confirm(`Delete job "${job.name}"?`)) deleteMutation.mutate(job.name) }}
          title="Delete"
          style={{
            background: 'transparent', border: 'none', cursor: 'pointer', padding: 2,
            color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
          }}
        >
          <X size={11} />
        </button>
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 19 }}>
        {job.steps.length} step{job.steps.length !== 1 ? 's' : ''}
        {lastRun && (
          <span style={{ marginLeft: 6, color: statusColor(lastRun.status) }}>
            · {lastRun.status} {lastRun.completedAt ? elapsed(lastRun.startedAt, lastRun.completedAt) : ''}
          </span>
        )}
        {!lastRun && <span style={{ marginLeft: 6 }}>· never run</span>}
      </div>
      {job.description && (
        <div style={{ fontSize: 10, color: 'var(--text-muted)', paddingLeft: 19, marginTop: 2, fontStyle: 'italic' }}>
          {job.description}
        </div>
      )}
    </div>
  )
}

// ── Step card in pipeline view ─────────────────────────────────────────────

function StepCard({
  step,
  index,
  total,
  selected,
  onClick,
}: {
  step: JobStepRun
  index: number
  total: number
  selected: boolean
  onClick: () => void
}) {
  const dur = step.startedAt ? elapsed(step.startedAt, step.completedAt) : null
  return (
    <div style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
      <div
        onClick={onClick}
        style={{
          flex: 1,
          background: selected ? 'rgba(124,110,245,0.1)' : 'var(--bg-elevated)',
          border: `1px solid ${selected ? 'rgba(124,110,245,0.5)' : step.status === 'running' ? 'rgba(124,110,245,0.3)' : 'rgba(255,255,255,0.07)'}`,
          borderRadius: 6,
          padding: '10px 10px',
          cursor: 'pointer',
          transition: 'border-color 0.15s, background 0.15s',
          opacity: step.status === 'pending' ? 0.45 : 1,
        }}
        onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'rgba(124,110,245,0.06)' }}
        onMouseLeave={e => { if (!selected) e.currentTarget.style.background = step.status === 'pending' ? 'var(--bg-elevated)' : 'var(--bg-elevated)' }}
      >
        <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 3 }}>Step {index + 1}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          <StatusIcon status={step.status} />
          <span style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-primary)' }}>{step.stepName}</span>
        </div>
        <div style={{ fontSize: 9, color: statusColor(step.status) }}>
          {step.status === 'pending' ? 'waiting' : step.status}
          {dur && <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>· {dur}</span>}
        </div>
      </div>
      {index < total - 1 && (
        <span style={{ color: 'var(--text-muted)', flexShrink: 0, margin: '0 4px', fontSize: 12 }}>›</span>
      )}
    </div>
  )
}

// ── Step detail panel ──────────────────────────────────────────────────────

function StepDetail({ step }: { step: JobStepRun }) {
  return (
    <div style={{ padding: '14px 16px', height: '100%', overflow: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <StatusIcon status={step.status} />
        <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{step.stepName}</span>
        <span style={{ fontSize: 11, color: statusColor(step.status), marginLeft: 'auto' }}>{step.status}</span>
      </div>

      {step.input && (
        <section style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Query sent</div>
          <div style={{
            background: 'var(--bg-void)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 5,
            padding: '8px 10px',
            fontSize: 11,
            color: 'var(--text-secondary)',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}>
            {step.input}
          </div>
        </section>
      )}

      {step.result && (
        <>
          <section style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Output</div>
            <div style={{
              background: 'var(--bg-void)',
              border: '1px solid rgba(255,255,255,0.06)',
              borderRadius: 5,
              padding: '8px 10px',
              fontSize: 11,
              color: 'var(--text-secondary)',
              lineHeight: 1.7,
            }}>
              {step.result.answer.map((line, i) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <span style={{ color: 'var(--text-muted)', marginRight: 6 }}>–</span>
                  {line}
                </div>
              ))}
              {step.result.answer.length === 0 && <span style={{ color: 'var(--text-muted)' }}>No output.</span>}
            </div>
          </section>

          {step.result.citations.length > 0 && (
            <section style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Citations ({step.result.citations.length})
              </div>
              {step.result.citations.slice(0, 8).map((c, i) => (
                <div key={i} style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 3, fontFamily: 'monospace' }}>
                  {c.repo}:{c.path}{c.title ? ` — ${c.title}` : ''}
                </div>
              ))}
            </section>
          )}

          {step.result.llmNotice && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', marginTop: 8 }}>
              {step.result.llmNotice}
            </div>
          )}
        </>
      )}

      {step.error && (
        <section>
          <div style={{ fontSize: 10, color: 'var(--health-error)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Error</div>
          <div style={{
            background: 'rgba(240,61,61,0.08)',
            border: '1px solid rgba(240,61,61,0.2)',
            borderRadius: 5,
            padding: '8px 10px',
            fontSize: 11,
            color: 'var(--health-error)',
            lineHeight: 1.6,
          }}>
            {step.error}
          </div>
        </section>
      )}

      {step.startedAt && (
        <div style={{ marginTop: 16, fontSize: 10, color: 'var(--text-muted)' }}>
          Started {new Date(step.startedAt).toLocaleTimeString()}
          {step.completedAt && ` · finished ${new Date(step.completedAt).toLocaleTimeString()}`}
        </div>
      )}
    </div>
  )
}

// ── Run pipeline view ──────────────────────────────────────────────────────

function RunPipeline({ run: initialRun, jobDef }: { run: JobRun; jobDef?: JobDefinition }) {
  const { selectedJobRunStep, setSelectedJobRunStep } = useFleetStore()

  // Live-update via polling when still in progress
  const { data: liveRun } = useJobRun(
    initialRun.status === 'running' || initialRun.status === 'queued' ? initialRun.jobId : null
  )
  const run = liveRun ?? initialRun

  const selectedStep = selectedJobRunStep !== null ? run.steps[selectedJobRunStep] : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <StatusIcon status={run.status} />
          <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{run.job}</span>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', fontFamily: 'monospace', marginLeft: 4 }}>
            #{run.jobId.slice(-8)}
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 11, color: statusColor(run.status) }}>
            {run.status}
            {run.startedAt && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>
                {elapsed(run.startedAt, run.completedAt)}
              </span>
            )}
          </span>
        </div>
        {jobDef?.description && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{jobDef.description}</div>
        )}
      </div>

      {/* Pipeline step cards */}
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
        gap: 0,
        padding: '14px 16px',
        borderBottom: '1px solid var(--border)',
        flexShrink: 0,
        overflowX: 'auto',
      }}>
        {run.steps.map((step, i) => (
          <StepCard
            key={step.stepName}
            step={step}
            index={i}
            total={run.steps.length}
            selected={selectedJobRunStep === i}
            onClick={() => setSelectedJobRunStep(selectedJobRunStep === i ? null : i)}
          />
        ))}
      </div>

      {/* Step detail or empty state */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {selectedStep ? (
          <StepDetail step={selectedStep} />
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12 }}>
            Click a step to see its query, output, and citations
          </div>
        )}
      </div>
    </div>
  )
}

// ── Empty state for the main panel ────────────────────────────────────────

function EmptyState({ jobSelected }: { jobSelected: boolean }) {
  if (jobSelected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--text-muted)' }}>
        <RefreshCw size={28} style={{ opacity: 0.3 }} />
        <div style={{ fontSize: 13 }}>No runs yet</div>
        <div style={{ fontSize: 11 }}>Click the run button to start this job</div>
      </div>
    )
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: 'var(--text-muted)' }}>
      <CheckCircle size={28} style={{ opacity: 0.3 }} />
      <div style={{ fontSize: 13 }}>No job selected</div>
      <div style={{ fontSize: 11 }}>Select a job from the list, or create one via <code style={{ fontFamily: 'monospace', fontSize: 11 }}>ctxhub job add</code></div>
    </div>
  )
}

// ── Main view ─────────────────────────────────────────────────────────────

export function JobsView() {
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null)

  const { data: jobsData } = useJobs()
  const { data: runsData } = useJobRuns()

  const jobs = jobsData?.jobs ?? []
  const allRuns = runsData?.runs ?? []

  // Most recent run for each job (for status indicator in the list)
  const lastRunByJob = new Map<string, JobRun>()
  for (const run of allRuns) {
    if (!lastRunByJob.has(run.job)) lastRunByJob.set(run.job, run)
  }

  const selectedJob = jobs.find(j => j.name === selectedJobName)
  const selectedJobRuns = selectedJobName ? allRuns.filter(r => r.job === selectedJobName) : []
  const latestRun = selectedJobRuns[0] ?? null

  // Count running jobs for the badge
  const runningCount = allRuns.filter(r => r.status === 'running' || r.status === 'queued').length

  return (
    <div style={{ display: 'flex', height: '100%', background: 'var(--bg-base)' }}>

      {/* ── Left sidebar: job list ─────────────────────────────────── */}
      <div style={{
        width: 240,
        flexShrink: 0,
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--bg-base)',
      }}>
        <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Jobs
            </span>
            {runningCount > 0 && (
              <span style={{
                fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3,
                background: 'rgba(124,110,245,0.2)', color: 'var(--accent)',
              }}>
                {runningCount} running
              </span>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
            Add via <code style={{ fontFamily: 'monospace', fontSize: 10 }}>ctxhub job add</code>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
          {jobs.length === 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 24, lineHeight: 1.6 }}>
              No jobs defined yet.<br />
              <span style={{ fontSize: 10 }}>Use <code style={{ fontFamily: 'monospace' }}>ctxhub job add</code></span>
            </div>
          ) : (
            jobs.map(job => (
              <JobListItem
                key={job.name}
                job={job}
                lastRun={lastRunByJob.get(job.name)}
                selected={selectedJobName === job.name}
                onClick={() => setSelectedJobName(selectedJobName === job.name ? null : job.name)}
              />
            ))
          )}
        </div>

        {/* Run history section */}
        {selectedJobName && selectedJobRuns.length > 1 && (
          <div style={{ borderTop: '1px solid var(--border)', padding: '8px' }}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 6, paddingLeft: 4 }}>
              Recent runs
            </div>
            {selectedJobRuns.slice(0, 5).map(run => (
              <div
                key={run.jobId}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 8px', borderRadius: 4, cursor: 'pointer',
                  fontSize: 10, color: 'var(--text-muted)',
                  background: run.jobId === latestRun?.jobId ? 'rgba(124,110,245,0.08)' : 'transparent',
                }}
              >
                <StatusIcon status={run.status} />
                <span style={{ fontFamily: 'monospace', fontSize: 9 }}>#{run.jobId.slice(-6)}</span>
                <span style={{ marginLeft: 'auto' }}>{elapsed(run.startedAt, run.completedAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Main panel: pipeline view ──────────────────────────────── */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {latestRun ? (
          <RunPipeline run={latestRun} jobDef={selectedJob} />
        ) : (
          <EmptyState jobSelected={selectedJobName !== null} />
        )}
      </div>

    </div>
  )
}
