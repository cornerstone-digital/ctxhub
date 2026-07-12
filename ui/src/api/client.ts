import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type {
  AgentToken,
  CaptainRunRecord,
  CaptainTask,
  CloudHistory,
  CloudStatus,
  CtxhubConfig,
  CtxhubEventEnvelope,
  EvalRunResult,
  ExecutionProfile,
  ExplainResult,
  GroupListResponse,
  IndexJobState,
  JobDefinition,
  JobRun,
  KnowledgeGraph,
  KnowledgeGraphEdge,
  KnowledgeNodeContent,
  PersonasStatus,
  RepoConfig,
  ReviewerProfile,
  ReviewResult,
  RolesResponse,
  SharingMode,
  SharingPolicy,
  SkillStatus,
  Workspace,
  WorkspaceMembersResponse,
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

async function patchJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
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

export function useCaptainStats() {
  return useQuery({
    queryKey: ['captain-stats'],
    queryFn: () => fetchJson<{ stats: Record<string, { runs: number; promoted: number }> }>('/captains/stats'),
    refetchInterval: 30_000,
  })
}

export function useEventHistory(opts: { limit?: number; types?: string[] } = {}) {
  const params = new URLSearchParams()
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.types?.length) params.set('types', opts.types.join(','))
  const qs = params.toString()
  return useQuery({
    queryKey: ['event-history', qs],
    queryFn: () => fetchJson<{ events: CtxhubEventEnvelope[]; count: number }>(`/events/history${qs ? `?${qs}` : ''}`),
    refetchInterval: 30_000,
  })
}

export function useCaptainRuns(name: string | null, opts: { limit?: number; offset?: number } = {}) {
  const limit = opts.limit ?? 50
  const offset = opts.offset ?? 0
  return useQuery({
    queryKey: ['captain-runs', name, limit, offset],
    queryFn: () => fetchJson<{ runs: CaptainRunRecord[]; total: number; limit: number; offset: number }>(
      `/captains/${encodeURIComponent(name!)}/runs?limit=${limit}&offset=${offset}`
    ),
    enabled: name !== null,
    refetchInterval: 30_000,
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

export function useReviewProfiles(workspace: string | null) {
  return useQuery({
    queryKey: ['review-profiles', workspace],
    queryFn: () => fetchJson<{ profiles: ReviewerProfile[] }>(`/workspaces/${encodeURIComponent(workspace!)}/review-profiles`),
    enabled: workspace !== null,
  })
}

export function useReviewMutation() {
  return useMutation({
    mutationFn: ({ workspace, topic, as, base }: { workspace: string; topic: string; as: string; base?: string }) =>
      postJson<ReviewResult>(`/workspaces/${encodeURIComponent(workspace)}/review`, { topic, as, base }),
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

// Fetched on demand when a node is clicked, not prefetched for the whole graph -- content can be
// large across 100+ nodes, and most of them never get clicked in a session.
export function useKnowledgeGraphNode(workspace: string | null, nodeId: string | null) {
  return useQuery({
    queryKey: ['knowledge-graph-node', workspace, nodeId],
    queryFn: () => fetchJson<KnowledgeNodeContent>(`/workspaces/${encodeURIComponent(workspace!)}/knowledge-graph/node?id=${encodeURIComponent(nodeId!)}`),
    enabled: workspace !== null && nodeId !== null,
  })
}

// Plain imperative fetch, not a useQuery hook: KnowledgeGraphView calls this directly from its
// node-click handler to splice fresh edges into the already-running d3 simulation, which is
// mutable canvas/ref state react-query's declarative cache model doesn't fit.
export async function fetchKnowledgeGraphExpand(workspace: string, nodeId: string): Promise<KnowledgeGraphEdge[]> {
  const result = await fetchJson<{ edges: KnowledgeGraphEdge[] }>(
    `/workspaces/${encodeURIComponent(workspace)}/knowledge-graph/expand?id=${encodeURIComponent(nodeId)}`
  )
  return result.edges
}

// --- Workspace config: repos, execution profiles, general settings ---------------------------

export function useWorkspaceConfig(name: string | null) {
  return useQuery({
    queryKey: ['workspace-config', name],
    queryFn: () => fetchJson<CtxhubConfig>(`/workspaces/${encodeURIComponent(name!)}/config`),
    enabled: name !== null,
  })
}

export function usePatchConfigMutation(name: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (patch: { knowledge?: Partial<CtxhubConfig['knowledge']>; privacy?: Partial<CtxhubConfig['privacy']>; llm?: Partial<CtxhubConfig['llm']> }) =>
      patchJson<CtxhubConfig>(`/workspaces/${encodeURIComponent(name)}/config`, patch),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['workspace-config', name] }),
  })
}

export function useAddRepoMutation(name: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (repo: { name: string; path: string }) => postJson<RepoConfig>(`/workspaces/${encodeURIComponent(name)}/repos`, repo),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspace-config', name] })
      void qc.invalidateQueries({ queryKey: ['workspace-repos', name] })
    },
  })
}

export function useRemoveRepoMutation(name: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (repoName: string) => deleteJson<{ removed: boolean }>(`/workspaces/${encodeURIComponent(name)}/repos/${encodeURIComponent(repoName)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspace-config', name] })
      void qc.invalidateQueries({ queryKey: ['workspace-repos', name] })
    },
  })
}

export function useUpsertExecutionProfileMutation(name: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; profile: ExecutionProfile }) =>
      postJson<{ name: string; profile: ExecutionProfile }>(`/workspaces/${encodeURIComponent(name)}/execution-profiles`, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['workspace-config', name] }),
  })
}

export function useRemoveExecutionProfileMutation(name: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (profileName: string) =>
      deleteJson<{ removed: boolean }>(`/workspaces/${encodeURIComponent(name)}/execution-profiles/${encodeURIComponent(profileName)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['workspace-config', name] }),
  })
}

// --- Skills & Personas ---------------------------------------------------------------------

export function useSkillsStatus(name: string | null) {
  return useQuery({
    queryKey: ['skills-status', name],
    queryFn: () => fetchJson<{ skills: SkillStatus[] }>(`/workspaces/${encodeURIComponent(name!)}/skills`),
    enabled: name !== null,
  })
}

export function useInstallSkillsMutation(name: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (agents: string[]) => postJson<{ skills: SkillStatus[] }>(`/workspaces/${encodeURIComponent(name)}/skills/install`, { agents }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['skills-status', name] }),
  })
}

export function usePersonasStatus(name: string | null) {
  return useQuery({
    queryKey: ['personas-status', name],
    queryFn: () => fetchJson<PersonasStatus>(`/workspaces/${encodeURIComponent(name!)}/personas`),
    enabled: name !== null,
  })
}

export function useInitPersonasMutation(name: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => postJson<{ created: string[]; status: PersonasStatus }>(`/workspaces/${encodeURIComponent(name)}/personas/init`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['personas-status', name] }),
  })
}

export function useSyncPersonasMutation(name: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (agents: string[]) => postJson<PersonasStatus>(`/workspaces/${encodeURIComponent(name)}/personas/sync`, { agents }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['personas-status', name] }),
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
    case 'skills.installed':
      return { text: `Installed skills for ${event.agents.join(', ') || 'all agents'} on "${event.workspace}"`, kind: 'ok' }
    case 'personas.synced':
      return { text: `Synced personas for ${event.agents.join(', ') || 'all agents'} on "${event.workspace}"`, kind: 'ok' }
    case 'job.queued':
      return { text: `Job "${event.job}" queued (${event.jobId.slice(-8)})`, kind: 'info' }
    case 'job.started':
      return { text: `Job "${event.job}" started`, kind: 'info' }
    case 'job.step.started':
      return { text: `Job "${event.job}" — step ${event.stepIndex + 1} "${event.step}" running`, kind: 'info' }
    case 'job.step.completed':
      return { text: `Job "${event.job}" — step "${event.step}" done`, kind: 'ok' }
    case 'job.step.failed':
      return { text: `Job "${event.job}" — step "${event.step}" failed: ${event.error}`, kind: 'error' }
    case 'job.completed':
      return { text: `Job "${event.job}" completed`, kind: 'ok' }
    case 'job.failed':
      return { text: `Job "${event.job}" failed: ${event.error}`, kind: 'error' }
    default:
      return { text: (event as { type: string }).type, kind: 'info' }
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
  const upsertJobRun = useFleetStore(s => s.upsertJobRun)

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

      // Job events: invalidate queries and eagerly fetch run to update the pipeline view
      if (
        event.type === 'job.queued' ||
        event.type === 'job.started' ||
        event.type === 'job.step.started' ||
        event.type === 'job.step.completed' ||
        event.type === 'job.step.failed' ||
        event.type === 'job.completed' ||
        event.type === 'job.failed'
      ) {
        void qc.invalidateQueries({ queryKey: ['job-runs'] })
        void qc.invalidateQueries({ queryKey: ['job-run', event.jobId] })
        void fetch(`/job-runs/${encodeURIComponent(event.jobId)}`)
          .then(r => r.ok ? r.json() as Promise<JobRun> : null)
          .then(run => { if (run) upsertJobRun(run) })
          .catch(() => {/* best-effort */})
      }

      const { text, kind } = summarize(event)
      addActivity(text, kind, event)
      if (
        event.type === 'index.completed' ||
        event.type === 'captain.run.completed' ||
        event.type === 'job.completed' ||
        event.type === 'job.failed'
      ) {
        notifyBrowser('ctxhub', text)
      }
    }

    return () => source.close()
  }, [qc, addActivity, upsertAgent, removeAgent, upsertJobRun])
}

// ── Jobs ─────────────────────────────────────────────────────────────────────

export function useJobs() {
  return useQuery({
    queryKey: ['jobs'],
    queryFn: () => fetchJson<{ jobs: JobDefinition[] }>('/jobs'),
    refetchInterval: 30_000,
  })
}

export function useJobRuns() {
  return useQuery({
    queryKey: ['job-runs'],
    queryFn: () => fetchJson<{ runs: JobRun[] }>('/job-runs'),
    // Poll quickly if any run is in progress, otherwise every 30s
    refetchInterval: (query) => {
      const runs = (query.state.data as { runs: JobRun[] } | undefined)?.runs ?? []
      return runs.some(r => r.status === 'running' || r.status === 'queued') ? 2_000 : 30_000
    },
  })
}

export function useJobRun(jobId: string | null) {
  return useQuery({
    queryKey: ['job-run', jobId],
    queryFn: () => fetchJson<JobRun>(`/job-runs/${encodeURIComponent(jobId!)}`),
    enabled: jobId !== null,
    refetchInterval: (query) => {
      const run = query.state.data as JobRun | undefined
      return run?.status === 'running' || run?.status === 'queued' ? 2_000 : false
    },
  })
}

export function useCreateJobMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (job: JobDefinition) => postJson<JobDefinition>('/jobs', job),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export function useDeleteJobMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => deleteJson<{ removed: boolean }>(`/jobs/${encodeURIComponent(name)}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['jobs'] }),
  })
}

export function useRunJobMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => postJson<{ jobId: string }>(`/jobs/${encodeURIComponent(name)}/run`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['job-runs'] })
    },
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

// ── Eval hooks ─────────────────────────────────────────────────────────────

export function useLatestEval(workspace: string | null) {
  return useQuery({
    queryKey: ['eval-latest', workspace],
    queryFn: () => fetchJson<EvalRunResult>(`/workspaces/${encodeURIComponent(workspace!)}/evals/latest`),
    enabled: workspace !== null,
    retry: false,
  })
}

export function useAddEvalCaseMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspace, query, expected }: { workspace: string; query: string; expected: Array<{ repo?: string; path?: string }> }) => {
      const res = await fetch(`/workspaces/${encodeURIComponent(workspace)}/evals/cases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, expected }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return res.json() as Promise<{ added: unknown; total: number }>
    },
    onSuccess: (_data, { workspace }) => {
      void qc.invalidateQueries({ queryKey: ['eval-latest', workspace] })
    },
  })
}

// ── Active profile hooks ───────────────────────────────────────────────────

export function useActiveProfile(workspace: string | null) {
  return useQuery({
    queryKey: ['active-profile', workspace],
    queryFn: () => fetchJson<{ activeProfile: string | null; profiles: string[] }>(
      `/workspaces/${encodeURIComponent(workspace!)}/active-profile`
    ),
    enabled: workspace !== null,
  })
}

export function useSetActiveProfileMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ workspace, profile }: { workspace: string; profile: string | null }) => {
      const res = await fetch(`/workspaces/${encodeURIComponent(workspace)}/active-profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
      return res.json() as Promise<{ activeProfile: string | null }>
    },
    onSuccess: (_data, { workspace }) => {
      void qc.invalidateQueries({ queryKey: ['active-profile', workspace] })
    },
  })
}

// ── Corporate Groups ─────────────────────────────────────────────────────────

export function useGroups() {
  return useQuery({
    queryKey: ['groups'],
    queryFn: () => fetchJson<GroupListResponse>('/groups'),
    refetchInterval: 30_000,
  })
}

export function useUpdateSharingMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ groupId, fromOrgId, toOrgId, mode }: { groupId: string; fromOrgId: string; toOrgId: string; mode: SharingMode }) =>
      patchJson<{ policy: SharingPolicy }>(`/groups/${encodeURIComponent(groupId)}/sharing`, { fromOrgId, toOrgId, mode }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['groups'] })
    },
  })
}

// ── Cloud ─────────────────────────────────────────────────────────────────────

export function useCloudStatus() {
  return useQuery({
    queryKey: ['cloud-status'],
    queryFn: () => fetchJson<CloudStatus>('/cloud/status'),
    refetchInterval: 30_000,
  })
}

export function useCloudHistory(opts: { limit?: number; type?: string } = {}) {
  const params = new URLSearchParams()
  if (opts.limit) params.set('limit', String(opts.limit))
  if (opts.type) params.set('type', opts.type)
  const qs = params.toString()
  return useQuery({
    queryKey: ['cloud-history', qs],
    queryFn: () => fetchJson<CloudHistory>(`/cloud/history${qs ? `?${qs}` : ''}`),
    refetchInterval: 30_000,
  })
}

export function useSyncCloudMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => postJson<{ synced: number; errors?: string[] }>('/cloud/sync'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['cloud-status'] })
      void qc.invalidateQueries({ queryKey: ['cloud-history'] })
    },
  })
}

// ── Roles ─────────────────────────────────────────────────────────────────────

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => fetchJson<RolesResponse>('/roles'),
  })
}

export function useWorkspaceMembers(workspace: string | null) {
  return useQuery({
    queryKey: ['workspace-members', workspace],
    queryFn: () => fetchJson<WorkspaceMembersResponse>(`/workspaces/${encodeURIComponent(workspace!)}/members`),
    enabled: workspace !== null,
  })
}

export function useGrantMemberRoleMutation(workspace: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ sub, role }: { sub: string; role: string }) =>
      postJson<{ sub: string; role: string }>(`/workspaces/${encodeURIComponent(workspace)}/members`, { sub, role }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspace-members', workspace] })
    },
  })
}

export function useRevokeMemberRoleMutation(workspace: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (sub: string) =>
      deleteJson<{ revoked: boolean }>(`/workspaces/${encodeURIComponent(workspace)}/members/${encodeURIComponent(sub)}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workspace-members', workspace] })
    },
  })
}
