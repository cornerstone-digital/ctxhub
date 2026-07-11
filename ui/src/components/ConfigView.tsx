import { useState, useEffect } from 'react'
import { Hexagon, ChevronDown, X, RefreshCw } from 'lucide-react'
import {
  useWorkspaces,
  useWorkspaceConfig,
  usePatchConfigMutation,
  useAddRepoMutation,
  useRemoveRepoMutation,
  useUpsertExecutionProfileMutation,
  useRemoveExecutionProfileMutation,
} from '../api/client'
import type { LlmAgentName } from '../types'

function fieldStyle() {
  return { background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)' }
}

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

function ReposSection({ workspace }: { workspace: string }) {
  const { data: config } = useWorkspaceConfig(workspace)
  const addRepo = useAddRepoMutation(workspace)
  const removeRepo = useRemoveRepoMutation(workspace)
  const [name, setName] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    if (!name.trim() || !repoPath.trim()) {
      setError('name and path are required')
      return
    }
    try {
      await addRepo.mutateAsync({ name: name.trim(), path: repoPath.trim() })
      setName('')
      setRepoPath('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <SectionHeader title="Repos" subtitle="Repositories indexed as part of this workspace" />
      <div className="space-y-1.5 mb-3">
        {(config?.repositories ?? []).map(repo => (
          <div key={repo.name} className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: 'var(--bg-elevated)' }}>
            <span className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>
              {repo.name}
            </span>
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {repo.path}
            </span>
            {repo.git && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--accent-dim)', color: 'var(--accent)' }}>
                git
              </span>
            )}
            <button onClick={() => void removeRepo.mutateAsync(repo.name)} style={{ color: 'var(--text-muted)' }}>
              <X size={13} />
            </button>
          </div>
        ))}
        {config && config.repositories.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No repos yet.
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Name" className="text-xs rounded-md px-2 py-1.5 w-32" style={fieldStyle()} />
        <input
          value={repoPath}
          onChange={e => setRepoPath(e.target.value)}
          placeholder="Path relative to workspace root"
          className="text-xs rounded-md px-2 py-1.5 flex-1"
          style={fieldStyle()}
        />
        <button
          onClick={() => void submit()}
          disabled={addRepo.isPending}
          className="text-xs font-medium rounded-md px-3 py-1.5 disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          Add
        </button>
      </div>
      {error && (
        <p className="text-xs mt-1" style={{ color: 'var(--health-error)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

const RUNTIMES: Array<LlmAgentName | 'direct-api'> = ['claude', 'codex', 'copilot', 'cursor', 'direct-api']

function ExecutionProfilesSection({ workspace }: { workspace: string }) {
  const { data: config } = useWorkspaceConfig(workspace)
  const upsert = useUpsertExecutionProfileMutation(workspace)
  const remove = useRemoveExecutionProfileMutation(workspace)
  const [name, setName] = useState('')
  const [runtime, setRuntime] = useState<LlmAgentName | 'direct-api'>('claude')
  const [model, setModel] = useState('')
  const [error, setError] = useState<string | null>(null)

  const profiles = config ? Object.entries(config.executionProfiles) : []

  const submit = async () => {
    setError(null)
    if (!name.trim()) {
      setError('name is required')
      return
    }
    try {
      await upsert.mutateAsync({ name: name.trim(), profile: { runtime, model: model.trim() || undefined } })
      setName('')
      setModel('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <SectionHeader title="Execution Profiles" subtitle="Binds a harness + model to a name, used via --profile <name>" />
      <div className="space-y-1.5 mb-3">
        {profiles.map(([profileName, profile]) => (
          <div key={profileName} className="flex items-center gap-2 px-3 py-2 rounded-md" style={{ background: 'var(--bg-elevated)' }}>
            <span className="text-xs font-medium flex-1" style={{ color: 'var(--text-primary)' }}>
              {profileName}
            </span>
            <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {profile.runtime}
              {profile.model ? `/${profile.model}` : ''}
            </span>
            <button onClick={() => void remove.mutateAsync(profileName)} style={{ color: 'var(--text-muted)' }}>
              <X size={13} />
            </button>
          </div>
        ))}
        {profiles.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            No execution profiles yet.
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Profile name" className="text-xs rounded-md px-2 py-1.5 w-32" style={fieldStyle()} />
        <select value={runtime} onChange={e => setRuntime(e.target.value as LlmAgentName | 'direct-api')} className="text-xs rounded-md px-2 py-1.5" style={fieldStyle()}>
          {RUNTIMES.map(r => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <input value={model} onChange={e => setModel(e.target.value)} placeholder="Model (optional)" className="text-xs rounded-md px-2 py-1.5 flex-1" style={fieldStyle()} />
        <button
          onClick={() => void submit()}
          disabled={upsert.isPending}
          className="text-xs font-medium rounded-md px-3 py-1.5 disabled:opacity-50"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          Add
        </button>
      </div>
      {error && (
        <p className="text-xs mt-1" style={{ color: 'var(--health-error)' }}>
          {error}
        </p>
      )}
    </div>
  )
}

function LineListEditor({ label, value, onSave }: { label: string; value: string[]; onSave: (lines: string[]) => void }) {
  const [text, setText] = useState(value.join('\n'))
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    setText(value.join('\n'))
    setDirty(false)
  }, [value])

  return (
    <div>
      <p className="text-[11px] font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </p>
      <textarea
        value={text}
        onChange={e => {
          setText(e.target.value)
          setDirty(true)
        }}
        rows={4}
        className="w-full text-[11px] font-mono rounded-md px-2 py-1.5 resize-none"
        style={fieldStyle()}
      />
      {dirty && (
        <button
          onClick={() => {
            onSave(text.split('\n').map(l => l.trim()).filter(Boolean))
            setDirty(false)
          }}
          className="text-[11px] font-medium rounded-md px-2 py-1 mt-1"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          Save
        </button>
      )}
    </div>
  )
}

function SettingsSection({ workspace }: { workspace: string }) {
  const { data: config } = useWorkspaceConfig(workspace)
  const patch = usePatchConfigMutation(workspace)

  if (!config) return null

  return (
    <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <SectionHeader title="Knowledge & Privacy" subtitle="What gets indexed, and what gets redacted before it does" />
      <div className="space-y-3">
        <LineListEditor label="Include globs" value={config.knowledge.include} onSave={include => void patch.mutateAsync({ knowledge: { include } })} />
        <LineListEditor label="Exclude globs" value={config.knowledge.exclude} onSave={exclude => void patch.mutateAsync({ knowledge: { exclude } })} />
        <LineListEditor
          label="Redact patterns (regex)"
          value={config.privacy.redactPatterns}
          onSave={redactPatterns => void patch.mutateAsync({ privacy: { redactPatterns } })}
        />
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="llm-enabled"
            checked={config.llm.enabled}
            onChange={e => void patch.mutateAsync({ llm: { enabled: e.target.checked } })}
          />
          <label htmlFor="llm-enabled" className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            LLM-drafted answer synthesis enabled
          </label>
        </div>
      </div>
    </div>
  )
}

export function ConfigView() {
  const { data: wsData } = useWorkspaces()
  const workspaces = wsData?.workspaces ?? []
  const [workspace, setWorkspace] = useState<string | null>(null)
  useEffect(() => {
    if (!workspace && workspaces.length > 0) setWorkspace(workspaces[0].name)
  }, [workspace, workspaces])

  const { isFetching } = useWorkspaceConfig(workspace)

  return (
    <div className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--bg-void)' }}>
      <div className="flex items-center gap-3 mb-4">
        <Hexagon size={16} style={{ color: 'var(--accent)' }} />
        <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Config
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
        {isFetching && <RefreshCw size={12} className="animate-spin" style={{ color: 'var(--text-muted)' }} />}
      </div>

      {workspace ? (
        <>
          <ReposSection workspace={workspace} />
          <ExecutionProfilesSection workspace={workspace} />
          <SettingsSection workspace={workspace} />
        </>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          No workspaces registered.
        </p>
      )}
    </div>
  )
}
