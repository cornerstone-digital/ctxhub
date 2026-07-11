import { useState } from 'react'
import { Users, X, ChevronDown, RefreshCw, CheckCircle, AlertTriangle } from 'lucide-react'
import {
  useCaptains,
  useCaptainRuns,
  useCreateCaptainMutation,
  useDeleteCaptainMutation,
  useRunCaptainMutation,
  usePromoteCaptainRunMutation,
  useWorkspaceRepos,
  useWorkspaces,
} from '../api/client'
import { relTime } from '../lib/utils'
import type { CaptainTask } from '../types'

function fieldStyle() {
  return {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    color: 'var(--text-primary)',
  }
}

function NewTaskForm({ onClose }: { onClose: () => void }) {
  const { data: wsData } = useWorkspaces()
  const { data: captainsData } = useCaptains()
  const workspaces = wsData?.workspaces ?? []
  const otherTasks = captainsData?.tasks ?? []
  const create = useCreateCaptainMutation()

  const [name, setName] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [query, setQuery] = useState('')
  const [persona, setPersona] = useState('')
  const [everyMinutes, setEveryMinutes] = useState('')
  const [handoffTo, setHandoffTo] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (!name.trim() || !workspace || !query.trim()) {
      setError('name, workspace, and query are required')
      return
    }
    try {
      await create.mutateAsync({
        name: name.trim(),
        workspace,
        query: query.trim(),
        persona: persona.trim() || undefined,
        schedule: everyMinutes ? { everyMinutes: Number(everyMinutes) } : undefined,
        handoffTo: handoffTo || undefined,
      })
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div
      className="rounded-lg p-4 mb-3 space-y-3"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
          New captain task
        </span>
        <button onClick={onClose} style={{ color: 'var(--text-muted)' }}>
          <X size={14} />
        </button>
      </div>

      <input
        value={name}
        onChange={e => setName(e.target.value)}
        placeholder="Task name"
        className="w-full text-xs rounded-md px-3 py-2"
        style={fieldStyle()}
      />

      <select value={workspace} onChange={e => setWorkspace(e.target.value)} className="w-full text-xs rounded-md px-3 py-2" style={fieldStyle()}>
        <option value="">Select workspace…</option>
        {workspaces.map(ws => (
          <option key={ws.name} value={ws.name}>
            {ws.name}
          </option>
        ))}
      </select>

      <textarea
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Query to run against the workspace, evidence-grounded via explain"
        rows={2}
        className="w-full text-xs rounded-md px-3 py-2 resize-none"
        style={fieldStyle()}
      />

      <div className="grid grid-cols-2 gap-2">
        <input
          value={persona}
          onChange={e => setPersona(e.target.value)}
          placeholder="Persona (optional)"
          className="text-xs rounded-md px-3 py-2"
          style={fieldStyle()}
        />
        <input
          value={everyMinutes}
          onChange={e => setEveryMinutes(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="Schedule every N min (optional)"
          className="text-xs rounded-md px-3 py-2"
          style={fieldStyle()}
        />
      </div>

      <select value={handoffTo} onChange={e => setHandoffTo(e.target.value)} className="w-full text-xs rounded-md px-3 py-2" style={fieldStyle()}>
        <option value="">No handoff</option>
        {otherTasks.filter(t => t.name !== name).map(t => (
          <option key={t.name} value={t.name}>
            Hand off to "{t.name}" on completion
          </option>
        ))}
      </select>

      {error && (
        <p className="text-xs" style={{ color: 'var(--health-error)' }}>
          {error}
        </p>
      )}

      <button
        onClick={() => void submit()}
        disabled={create.isPending}
        className="w-full text-xs font-medium rounded-md px-3 py-2 disabled:opacity-50"
        style={{ background: 'var(--accent)', color: 'white' }}
      >
        {create.isPending ? 'Creating…' : 'Create task'}
      </button>
    </div>
  )
}

function PromoteForm({ task, runId, onDone }: { task: string; runId: string; onDone: () => void }) {
  const captain = useCaptains().data?.tasks.find(t => t.name === task)
  const { data: reposData } = useWorkspaceRepos(captain?.workspace ?? null)
  const repos = reposData?.repos ?? []
  const promote = usePromoteCaptainRunMutation()
  const [repo, setRepo] = useState('')
  const [result, setResult] = useState<string | null>(null)

  return (
    <div className="flex items-center gap-2 mt-2">
      <select value={repo} onChange={e => setRepo(e.target.value)} className="text-xs rounded-md px-2 py-1 flex-1" style={fieldStyle()}>
        <option value="">Select repo…</option>
        {repos.map(r => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <button
        disabled={!repo || promote.isPending}
        onClick={() =>
          void promote.mutateAsync({ name: task, runId, repo }).then(res => {
            setResult(res.notePath)
            onDone()
          }).catch(err => setResult(`Error: ${(err as Error).message}`))
        }
        className="text-[10px] font-medium rounded-md px-2 py-1 disabled:opacity-40"
        style={{ background: 'var(--accent)', color: 'white' }}
      >
        Promote
      </button>
      {result && (
        <span className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
          {result}
        </span>
      )}
    </div>
  )
}

function TaskRuns({ task }: { task: CaptainTask }) {
  const { data, isLoading } = useCaptainRuns(task.name)
  const runs = data?.runs ?? []
  const [promoting, setPromoting] = useState<string | null>(null)

  if (isLoading) return <p className="text-[11px] px-2 py-2" style={{ color: 'var(--text-muted)' }}>Loading runs…</p>
  if (runs.length === 0) return <p className="text-[11px] px-2 py-2" style={{ color: 'var(--text-muted)' }}>No runs yet. Click "Run now" above.</p>

  return (
    <div className="space-y-2 px-2 pb-2">
      {[...runs].reverse().map(run => (
        <div key={run.runId} className="rounded-md p-2" style={{ background: 'var(--bg-elevated)' }}>
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {relTime(run.startedAt)}
              {run.handoffFrom && <span> · handed off from "{run.handoffFrom}"</span>}
            </span>
            <button
              onClick={() => setPromoting(promoting === run.runId ? null : run.runId)}
              className="text-[10px]"
              style={{ color: 'var(--accent)' }}
            >
              Promote…
            </button>
          </div>
          <ul className="mt-1 space-y-0.5">
            {run.result.answer.map((line, i) => (
              <li key={i} className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {line}
              </li>
            ))}
          </ul>
          {promoting === run.runId && <PromoteForm task={task.name} runId={run.runId} onDone={() => setPromoting(null)} />}
        </div>
      ))}
    </div>
  )
}

function TaskCard({ task }: { task: CaptainTask }) {
  const [expanded, setExpanded] = useState(false)
  const [lastRunStatus, setLastRunStatus] = useState<'ok' | 'error' | null>(null)
  const run = useRunCaptainMutation()
  const del = useDeleteCaptainMutation()

  return (
    <div className="rounded-lg mb-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-1"
          style={{ color: 'var(--text-muted)' }}
        >
          <ChevronDown size={13} style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s' }} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              {task.name}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
              {task.workspace}
            </span>
            {task.schedule && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                every {task.schedule.everyMinutes}m
              </span>
            )}
            {task.handoffTo && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>
                → {task.handoffTo}
              </span>
            )}
          </div>
          <p className="text-[11px] truncate mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {task.query}
          </p>
        </div>
        {lastRunStatus === 'ok' && <CheckCircle size={13} style={{ color: 'var(--health-ok)' }} />}
        {lastRunStatus === 'error' && <AlertTriangle size={13} style={{ color: 'var(--health-error)' }} />}
        <button
          disabled={run.isPending}
          onClick={() => {
            setLastRunStatus(null)
            void run
              .mutateAsync(task.name)
              .then(() => setLastRunStatus('ok'))
              .catch(() => setLastRunStatus('error'))
          }}
          className="flex items-center gap-1 text-[11px] font-medium rounded-md px-2 py-1 disabled:opacity-50"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
        >
          <RefreshCw size={11} className={run.isPending ? 'animate-spin' : ''} />
          Run now
        </button>
        <button
          onClick={() => {
            if (confirm(`Remove captain task "${task.name}"?`)) void del.mutateAsync(task.name)
          }}
          style={{ color: 'var(--text-muted)' }}
        >
          <X size={14} />
        </button>
      </div>
      {expanded && (
        <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          <TaskRuns task={task} />
        </div>
      )}
    </div>
  )
}

export function CaptainsView() {
  const { data, isLoading } = useCaptains()
  const tasks = data?.tasks ?? []
  const [showForm, setShowForm] = useState(false)

  return (
    <div className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--bg-void)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Users size={16} style={{ color: 'var(--accent)' }} />
          <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Captains
          </h1>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            ({tasks.length})
          </span>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="text-xs font-medium rounded-md px-3 py-1.5"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          + New task
        </button>
      </div>

      {showForm && <NewTaskForm onClose={() => setShowForm(false)} />}

      {isLoading && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </p>
      )}
      {!isLoading && tasks.length === 0 && !showForm && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-2xl">🧭</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            No captain tasks defined
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Create one to run evidence-grounded queries on a schedule, and optionally hand results off to another task.
          </p>
        </div>
      )}
      {tasks.map(task => (
        <TaskCard key={task.name} task={task} />
      ))}
    </div>
  )
}
