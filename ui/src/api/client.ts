import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { CtxhubEventEnvelope, ExplainResult, IndexJobState, Workspace, WorkspaceStatus } from '../types'
import { useFleetStore } from '../store/fleet'

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url)
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
    default:
      return { text: event.type, kind: 'info' }
  }
}

function notifyBrowser(title: string, body: string): void {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(title, { body })
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

  useEffect(() => {
    const source = new EventSource('/events')

    source.onmessage = e => {
      let event: CtxhubEventEnvelope
      try {
        event = JSON.parse(e.data) as CtxhubEventEnvelope
      } catch {
        return
      }

      if (event.type.startsWith('index.')) {
        qc.setQueryData<IndexJobState>(['index-status', event.workspace], (prev): IndexJobState => {
          const base = prev ?? { status: 'idle' as const, scanned: 0, total: 0 }
          if (event.type === 'index.started') return { ...base, status: 'running', scanned: 0, total: 0, startedAt: event.at };
          if (event.type === 'index.progress') return { ...base, status: 'running', repo: event.repo, scanned: event.scanned, total: event.total };
          if (event.type === 'index.completed') return { ...base, status: 'done', result: event.result, finishedAt: event.at };
          if (event.type === 'index.failed') return { ...base, status: 'error', error: event.error, finishedAt: event.at };
          return base
        })
      }

      if (event.type === 'index.progress') return

      const { text, kind } = summarize(event)
      addActivity(text, kind, event)
      if (event.type === 'index.completed' || event.type === 'captain.run.completed') {
        notifyBrowser('ctxhub', text)
      }
    }

    return () => source.close()
  }, [qc, addActivity])
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
