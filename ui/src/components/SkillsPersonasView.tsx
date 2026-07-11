import { useState, useEffect } from 'react'
import { Folder, ChevronDown, RefreshCw, CheckCircle, XCircle } from 'lucide-react'
import {
  useWorkspaces,
  useSkillsStatus,
  useInstallSkillsMutation,
  usePersonasStatus,
  useInitPersonasMutation,
  useSyncPersonasMutation,
} from '../api/client'
import type { LlmAgentName } from '../types'

const AGENTS: LlmAgentName[] = ['claude', 'codex', 'copilot', 'cursor']

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-2">
      <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
        {title}
      </h2>
      {subtitle && (
        <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {subtitle}
        </p>
      )}
    </div>
  )
}

function SkillsSection({ workspace }: { workspace: string }) {
  const { data, isLoading } = useSkillsStatus(workspace)
  const install = useInstallSkillsMutation(workspace)
  const skills = data?.skills ?? []

  const byAgent = AGENTS.map(agent => ({
    agent,
    skills: skills.filter(s => s.agent === agent),
  }))

  return (
    <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <SectionHeader title="Skills" subtitle="Chat-native ctxhub usage guidance, installed per harness" />
      {isLoading && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </p>
      )}
      <div className="space-y-2">
        {byAgent.map(({ agent, skills: agentSkills }) => {
          const allInstalled = agentSkills.length > 0 && agentSkills.every(s => s.installed)
          return (
            <div key={agent} className="rounded-md p-3" style={{ background: 'var(--bg-elevated)' }}>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  {agent}
                </span>
                <button
                  onClick={() => void install.mutateAsync([agent])}
                  disabled={install.isPending}
                  className="flex items-center gap-1 text-[11px] font-medium rounded-md px-2 py-1 disabled:opacity-50"
                  style={{ background: allInstalled ? 'var(--bg-surface)' : 'var(--accent)', color: allInstalled ? 'var(--text-secondary)' : 'white', border: allInstalled ? '1px solid var(--border)' : 'none' }}
                >
                  <RefreshCw size={11} className={install.isPending ? 'animate-spin' : ''} />
                  {allInstalled ? 'Reinstall' : 'Install'}
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {agentSkills.map(skill => (
                  <span
                    key={skill.id}
                    className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{
                      background: skill.installed ? 'rgba(15,217,123,0.12)' : 'var(--bg-surface)',
                      color: skill.installed ? 'var(--health-ok)' : 'var(--text-muted)',
                      border: `1px solid ${skill.installed ? 'rgba(15,217,123,0.3)' : 'var(--border)'}`,
                    }}
                  >
                    {skill.installed ? <CheckCircle size={10} /> : <XCircle size={10} />}
                    {skill.id}
                  </span>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PersonasSection({ workspace }: { workspace: string }) {
  const { data, isLoading } = usePersonasStatus(workspace)
  const initMutation = useInitPersonasMutation(workspace)
  const syncMutation = useSyncPersonasMutation(workspace)

  const personas = data?.personas ?? []
  const compiledFor = data?.compiledFor ?? []

  return (
    <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <SectionHeader title="Personas" subtitle="Portable agent personas, compiled to a native subagent file per harness" />
      {isLoading && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </p>
      )}

      {!isLoading && personas.length === 0 && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No personas configured yet.
          </p>
          <button
            onClick={() => void initMutation.mutateAsync()}
            disabled={initMutation.isPending}
            className="text-xs font-medium rounded-md px-3 py-1.5 disabled:opacity-50"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            Scaffold agents/ with a starter persona
          </button>
        </div>
      )}

      {personas.length > 0 && (
        <>
          <div className="space-y-1.5 mb-3">
            {personas.map(persona => (
              <div key={persona.name} className="px-3 py-2 rounded-md" style={{ background: 'var(--bg-elevated)' }}>
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  {persona.name}
                </span>
                {persona.description && (
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {persona.description}
                  </p>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            {AGENTS.map(agent => (
              <button
                key={agent}
                onClick={() => void syncMutation.mutateAsync([agent])}
                disabled={syncMutation.isPending}
                className="flex items-center gap-1 text-[11px] font-medium rounded-md px-2 py-1 disabled:opacity-50"
                style={{
                  background: compiledFor.includes(agent) ? 'rgba(15,217,123,0.12)' : 'var(--bg-elevated)',
                  color: compiledFor.includes(agent) ? 'var(--health-ok)' : 'var(--text-secondary)',
                  border: `1px solid ${compiledFor.includes(agent) ? 'rgba(15,217,123,0.3)' : 'var(--border)'}`,
                }}
              >
                {compiledFor.includes(agent) ? <CheckCircle size={11} /> : <RefreshCw size={11} className={syncMutation.isPending ? 'animate-spin' : ''} />}
                Sync {agent}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function SkillsPersonasView() {
  const { data: wsData } = useWorkspaces()
  const workspaces = wsData?.workspaces ?? []
  const [workspace, setWorkspace] = useState<string | null>(null)
  useEffect(() => {
    if (!workspace && workspaces.length > 0) setWorkspace(workspaces[0].name)
  }, [workspace, workspaces])

  return (
    <div className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--bg-void)' }}>
      <div className="flex items-center gap-3 mb-4">
        <Folder size={16} style={{ color: 'var(--accent)' }} />
        <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Skills & Personas
        </h1>
        <div className="flex items-center gap-1">
          <ChevronDown size={11} style={{ color: 'var(--text-muted)' }} />
          <select
            value={workspace ?? ''}
            onChange={e => setWorkspace(e.target.value || null)}
            className="text-xs"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)' }}
          >
            {workspaces.map(ws => (
              <option key={ws.name} value={ws.name}>
                {ws.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {workspace ? (
        <>
          <SkillsSection workspace={workspace} />
          <PersonasSection workspace={workspace} />
        </>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No workspaces registered.
        </p>
      )}
    </div>
  )
}
