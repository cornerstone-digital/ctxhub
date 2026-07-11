import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  AgentToken,
  CaptainRunRecord,
  CaptainTask,
  CtxhubEventEnvelope,
  ExplainResult,
  IndexJobState,
  KnowledgeGraph,
  Workspace,
  WorkspaceStatus,
} from '../types'
import { useFleetStore } from '../store/fleet'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

async function deleteJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json() as Promise<T>
}

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => fetchJson<{ status: string; version: string }>('/health'),
    refetchInterval: 30_000,
  })
}

export function useWorkspaces() {
  return useQuery({
    queryKey: ['workspaces'],
    queryFn: () => fetchJson<{ workspaces: Workspace[] }>('/workspaces'),
    refetchInterval: 30_000,
  })
}

export function useWorkspaceStatus(name: string | null) {
  return useQuery({
    queryKey: ['workspace-status', name],
    queryFn: () => fetchJson<WorkspaceStatus>(`/workspaces/${encodeURIComponent(name!)}/status`),
    enabled: name !== null,
    refetchInterval: 30_000,
  })
}

// Polls quickly (2s) while a job is actually running, then backs off to the same 30s cadence
// as everything else once it settles -- avoids hammering the service for workspaces that are
// idle almost all the time, while still feeling responsive during an active index run.
export function useIndexStatus(name: string | null) {
  return useQuery({
    queryKey: ['index-status', name],
    queryFn: () => fetchJson<IndexJobState>(`/workspaces/${encodeURIComponent(name!)}/index-status`),
    enabled: name !== null,
    refetchInterval: query => (query.state.data?.status === 'running' ? 2_000 : 30_000),
  })
}

export function useStartIndexMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string): Promise<IndexJobState> => {
      const res = await fetch(`/workspaces/${encodeURIComponent(name)}/index`, { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return res.json() as Promise<IndexJobState>
    },
    onSuccess: (_data, name) => {
      void qc.invalidateQueries({ queryKey: ['index-status', name] })
    },
  })
}

export function useCaptains() {
  return useQuery({
    queryKey: ['captains'],
    queryFn: () => fetchJson<{ tasks: CaptainTask[] }>('/captains'),
    refetchInterval: 30_000,
  })
}

export function useCaptainRuns(name: string | null) {
  return useQuery({
    queryKey: ['captain-runs', name],
    queryFn: () => fetchJson<{ runs: CaptainRunRecord[] }>(`/captains/${encodeURIComponent(name!)}/runs`),
    enabled: name !== null,
  })
}

export function useWorkspaceRepos(name: string | null) {
  return useQuery({
    queryKey: ['workspace-repos', name],
    queryFn: () => fetchJson<{ repos: string[] }>(`/workspaces/${encodeURIComponent(name!)}/repos`),
    enabled: name !== null,
  })
}

export function useCreateCaptainMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (task: Partial<CaptainTask>) => postJson<CaptainTask>('/captains', task),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['captains'] }),
  })
}

export function useDeleteCaptainMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => deleteJson<{ removed: boolean }>(`/captains/${encodeURIComponent(name)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['captains'] }),
  })
}

export function useRunCaptainMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => postJson<CaptainRunRecord>(`/captains/${encodeURIComponent(name)}/run`),
    onSuccess: record => {
      void qc.invalidateQueries({ queryKey: ['captain-runs', record.task] })
    },
  })
}

export function usePromoteCaptainRunMutation() {
  return useMutation({
    mutationFn: ({ name, runId, repo, title }: { name: string; runId: string; repo: string; title?: string }) =>
      postJson<{ notePath: string }>(`/captains/${encodeURIComponent(name)}/runs/${encodeURIComponent(runId)}/promote`, { repo, title }),
  })
}

// staleTime, not refetchInterval: this is an expensive-ish computed view (a search call per
// indexed file), not a cheap status poll -- recomputing on every focus/mount would be wasteful
// when the underlying index rarely changes within a session. Re-indexing invalidates it instead
// (see useEventStream's index.completed handling).
export function useKnowledgeGraph(name: string | null) {
  return useQuery({
    queryKey: ['knowledge-graph', name],
    queryFn: () => fetchJson<KnowledgeGraph>(`/workspaces/${encodeURIComponent(name!)}/knowledge-graph`),
    enabled: name !== null,
    staleTime: 60_000,
  })
}

function summarize(event: CtxhubEventEnvelope): { text: string; kind: 'ok' | 'warn' | 'error' | 'info' } {
  switch (event.type) {
    case 'index.started':
      return { text: `Started indexing "${event.workspace}"`, kind: 'info' }
    case 'index.completed':
      return { text: `Finished indexing "${event.workspace}" — ${event.result.indexed} indexed, ${event.result.deleted} deleted`, kind: 'ok' }
    case 'index.failed':
      return { text: `Indexing "${event.workspace}" failed: ${event.error}`, kind: 'error' }
    case 'captain.run.started':
      return { text: `Captain "${event.task}" started on "${event.workspace}"`, kind: 'info' }
    case 'captain.run.completed':
      return { text: `Captain "${event.task}" finished on "${event.workspace}"`, kind: 'ok' }
    case 'captain.run.failed':
      return { text: `Captain "${event.task}" failed on "${event.workspace}": ${event.error}`, kind: 'error' }
    case 'captain.handoff':
      return { text: `Captain "${event.from}" handed off to "${event.to}"`, kind: 'info' }
    default:
      return { text: event.type, kind: 'info' }
  }
}

function notifyBrowser(title: string, body: string): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body })
  }
}

// How long a finished/failed bot lingers on the graph before vanishing, and how long a handoff
// bot takes to travel from its source to its destination node -- both purely cosmetic, tuned to
// feel readable rather than to match any real duration.
const AGENT_LINGER_MS = 1400
export const HANDOFF_TRAVEL_MS = 1400

function applyAgentToken(
  event: CtxhubEventEnvelope,
  upsertAgent: (token: AgentToken) => void,
  removeAgent: (id: string) => void
): void {
  switch (event.type) {
    case 'index.started':
      upsertAgent({ id: `index:${event.workspace}`, kind: 'index', label: 'Indexing', workspaceId: event.workspace, state: 'working', percent: 0, spawnedAt: Date.now() })
      return
    case 'index.progress':
      upsertAgent({
        id: `index:${event.workspace}`,
        kind: 'index',
        label: 'Indexing',
        workspaceId: event.workspace,
        state: 'working',
        percent: event.total > 0 ? (event.scanned / event.total) * 100 : 0,
        spawnedAt: Date.now(),
      })
      return
    case 'index.completed': {
      const id = `index:${event.workspace}`
      upsertAgent({ id, kind: 'index', label: 'Indexed', workspaceId: event.workspace, state: 'done', spawnedAt: Date.now() })
      setTimeout(() => removeAgent(id), AGENT_LINGER_MS)
      return
    }
    case 'index.failed': {
      const id = `index:${event.workspace}`
      upsertAgent({ id, kind: 'index', label: 'Index failed', workspaceId: event.workspace, state: 'error', spawnedAt: Date.now() })
      setTimeout(() => removeAgent(id), AGENT_LINGER_MS)
      return
    }
    case 'captain.run.started':
      upsertAgent({ id: `captain:${event.task}`, kind: 'captain', label: event.task, workspaceId: event.workspace, state: 'working', spawnedAt: Date.now() })
      return
    case 'captain.run.completed': {
      const id = `captain:${event.task}`
      upsertAgent({ id, kind: 'captain', label: event.task, workspaceId: event.workspace, state: 'done', spawnedAt: Date.now() })
      setTimeout(() => removeAgent(id), AGENT_LINGER_MS)
      return
    }
    case 'captain.run.failed': {
      const id = `captain:${event.task}`
      upsertAgent({ id, kind: 'captain', label: event.task, workspaceId: event.workspace, state: 'error', spawnedAt: Date.now() })
      setTimeout(() => removeAgent(id), AGENT_LINGER_MS)
      return
    }
    case 'captain.handoff': {
      // Own id per handoff (not keyed by task name like the others) -- a bot mid-flight between
      // nodes shouldn't ever collide with or get clobbered by a same-named task's next run.
      const id = `handoff:${event.from}-${event.to}:${event.id}`
      upsertAgent({
        id,
        kind: 'captain',
        label: `${event.from} → ${event.to}`,
        workspaceId: event.fromWorkspace,
        toWorkspaceId: event.toWorkspace,
        state: 'traveling',
        spawnedAt: Date.now(),
      })
      setTimeout(() => removeAgent(id), HANDOFF_TRAVEL_MS)
      return
    }
  }
}

// The single SSE connection for the whole app (mounted once from App.tsx). Every event bus
// event lands here and fans out to two places: the Event Log (every event type, as a clickable
// row carrying the full raw envelope) and, for index jobs specifically, the react-query cache
// for ['index-status', workspace] so the Sidebar's progress bar updates instantly instead of
// waiting for its next poll. index.progress deliberately isn't logged as its own row -- it can
// fire many times a second during a large index run, and a legible log matters more than
// capturing every tick; the cache update still makes that progress visible live in the sidebar.
export function useEventStream() {
  const qc = useQueryClient()
  const addActivity = useFleetStore(s => s.addActivity)
  const upsertAgent = useFleetStore(s => s.upsertAgent)
  const removeAgent = useFleetStore(s => s.removeAgent)

  useEffect(() => {
    const source = new EventSource('/events')

    source.onmessage = e => {
      let event: CtxhubEventEnvelope
      try {
        event = JSON.parse(e.data) as CtxhubEventEnvelope
      } catch {
        return
      }

      if (event.type === 'index.started' || event.type === 'index.progress' || event.type === 'index.completed' || event.type === 'index.failed') {
        qc.setQueryData<IndexJobState>(['index-status', event.workspace], (prev): IndexJobState => {
          const base = prev ?? { status: 'idle' as const, scanned: 0, total: 0 }
          if (event.type === 'index.started') return { ...base, status: 'running', scanned: 0, total: 0, startedAt: event.at };
          if (event.type === 'index.progress') return { ...base, status: 'running', repo: event.repo, scanned: event.scanned, total: event.total };
          if (event.type === 'index.completed') return { ...base, status: 'done', result: event.result, finishedAt: event.at };
          if (event.type === 'index.failed') return { ...base, status: 'error', error: event.error, finishedAt: event.at };
          return base
        })
      }

      applyAgentToken(event, upsertAgent, removeAgent)

      if (event.type === 'index.completed') {
        void qc.invalidateQueries({ queryKey: ['knowledge-graph', event.workspace] })
      }
      if (event.type === 'captain.run.completed' || event.type === 'captain.run.failed') {
        void qc.invalidateQueries({ queryKey: ['captain-runs', event.task] })
      }

      if (event.type === 'index.progress') return

      const { text, kind } = summarize(event)
      addActivity(text, kind, event)
      if (event.type === 'index.completed' || event.type === 'captain.run.completed') {
        notifyBrowser('ctxhub', text)
      }
    }

    return () => source.close()
  }, [qc, addActivity, upsertAgent, removeAgent])
}

export function useChatMutation() {
  return useMutation({
    mutationFn: async ({ name, query }: { name: string; query: string }): Promise<ExplainResult> => {
      const res = await fetch(`/workspaces/${encodeURIComponent(name)}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return res.json() as Promise<ExplainResult>
    },
  })
}
