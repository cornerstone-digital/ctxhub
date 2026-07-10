import { useQuery, useMutation } from '@tanstack/react-query'
import type { ExplainResult, Workspace, WorkspaceStatus } from '../types'

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
