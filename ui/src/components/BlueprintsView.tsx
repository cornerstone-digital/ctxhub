import { useState } from 'react'
import { Package, Search, Download } from 'lucide-react'
import { useBlueprintHub, useInstallBlueprintMutation } from '../api/client'
import { relTime } from '../lib/utils'

export function BlueprintsView() {
  const [query, setQuery] = useState('')
  const [workspace, setWorkspace] = useState('')
  const { data, isLoading } = useBlueprintHub(query, workspace || undefined)
  const install = useInstallBlueprintMutation()
  const [installedName, setInstalledName] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const notConfigured = !isLoading && data && !data.configured

  const handleInstall = async (name: string, version: string) => {
    setError(null)
    setInstalledName(null)
    try {
      await install.mutateAsync(`${name}@${version}`)
      setInstalledName(name)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  return (
    <div className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--bg-void)' }}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Package size={16} style={{ color: 'var(--accent)' }} />
          <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Blueprints
          </h1>
          {data && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              ({data.blueprints.length})
            </span>
          )}
        </div>

        {!notConfigured && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '4px 8px' }}>
              <Search size={12} style={{ color: 'var(--text-muted)' }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search name, description, tags..."
                className="text-xs w-56"
                style={{ background: 'transparent', border: 'none', color: 'var(--text-primary)', outline: 'none' }}
              />
            </div>
            <input
              value={workspace}
              onChange={e => setWorkspace(e.target.value)}
              placeholder="filter by workspace's service type"
              title="Resolves this workspace's service type via the Org Graph topology and only shows blueprints that declare a matching serviceType"
              className="text-xs w-56 px-2 py-1.5 rounded-md"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }}
            />
          </div>
        )}
      </div>

      {notConfigured && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-2xl">📦</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Cloud sync not configured</p>
          <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
            ctxhub cloud configure --endpoint &lt;url&gt; --api-key &lt;key&gt;
          </p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            The Blueprint Hub is the same Cloud service as sync — one endpoint, no separate registry to configure.
          </p>
        </div>
      )}

      {!notConfigured && isLoading && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      )}

      {!notConfigured && !isLoading && data?.blueprints.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            {query ? 'No blueprints match your search' : 'No blueprints published yet'}
          </p>
          <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>ctxhub blueprint publish &lt;dir&gt; [--public]</p>
        </div>
      )}

      {error && (
        <p className="text-xs mb-3" style={{ color: 'var(--health-error)' }}>
          Install failed: {error}
        </p>
      )}

      <div className="space-y-2">
        {data?.blueprints.map(bp => (
          <div
            key={`${bp.name}@${bp.version}`}
            className="p-3 rounded-md"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                    {bp.name}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                    v{bp.version}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ color: bp.orgId === null ? 'var(--health-ok)' : 'var(--accent)' }}
                  >
                    {bp.orgId === null ? 'public' : 'org-private'}
                  </span>
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
                  {bp.description}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                  {bp.author && (
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                      by {bp.author}
                    </span>
                  )}
                  <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    published {relTime(bp.publishedAt)}
                  </span>
                  {bp.tags?.map(tag => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--text-muted)', background: 'var(--bg-elevated)' }}>
                      {tag}
                    </span>
                  ))}
                  {bp.serviceTypes?.map(st => (
                    <span key={st} className="text-[10px] px-1.5 py-0.5 rounded" style={{ color: 'var(--accent)', background: 'var(--bg-elevated)' }}>
                      {st}
                    </span>
                  ))}
                </div>
              </div>
              <button
                onClick={() => void handleInstall(bp.name, bp.version)}
                disabled={install.isPending}
                className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md flex-shrink-0 disabled:opacity-50"
                style={{ background: 'var(--accent)', color: 'white' }}
              >
                <Download size={12} />
                {installedName === bp.name ? 'Installed ✓' : 'Install'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
