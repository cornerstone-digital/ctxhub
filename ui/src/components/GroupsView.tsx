import { Building2 } from 'lucide-react'
import { useGroups, useUpdateSharingMutation } from '../api/client'
import type { SharingMode } from '../types'

const TRUST_TIER_COLOR: Record<string, string> = {
  observer: 'var(--text-muted)',
  participant: 'var(--health-warn)',
  trusted: 'var(--health-ok)',
}

const SHARING_MODES: SharingMode[] = ['none', 'read', 'bidirectional']

export function GroupsView() {
  const { data, isLoading } = useGroups()
  const sharingMutation = useUpdateSharingMutation()

  const groups = data?.groups ?? []
  const orgs = data?.orgs ?? []
  const policies = data?.sharingPolicies ?? []

  function modeFor(fromOrgId: string, toOrgId: string): SharingMode {
    if (fromOrgId === toOrgId) return 'bidirectional'
    return policies.find(p => p.fromOrgId === fromOrgId && p.toOrgId === toOrgId)?.mode ?? 'none'
  }

  return (
    <div className="w-full h-full overflow-y-auto p-5" style={{ background: 'var(--bg-void)' }}>
      <div className="flex items-center gap-2 mb-4">
        <Building2 size={16} style={{ color: 'var(--accent)' }} />
        <h1 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Corporate Groups
        </h1>
        {data && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            ({groups.length})
          </span>
        )}
      </div>

      {isLoading && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</p>
      )}

      {!isLoading && groups.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
          <p className="text-2xl">🏢</p>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No corporate groups configured</p>
          <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>ctxhub group create --name &lt;name&gt;</p>
        </div>
      )}

      <div className="space-y-5">
        {groups.map(group => {
          const groupOrgs = orgs.filter(o => o.groupId === group.id)
          return (
            <div key={group.id} className="p-3 rounded-md" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>{group.name}</p>

              {groupOrgs.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>No orgs in this group yet.</p>
              ) : (
                <>
                  {/* Org list */}
                  <div className="space-y-1.5 mb-4">
                    {groupOrgs.map(org => (
                      <div key={org.id} className="flex items-center justify-between px-2.5 py-1.5 rounded" style={{ background: 'var(--bg-void)' }}>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>{org.name}</p>
                          <p className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{org.tenantId}</p>
                        </div>
                        <span className="text-[10px] px-1.5 py-0.5 rounded flex-shrink-0" style={{ color: TRUST_TIER_COLOR[org.trustTier] }}>
                          {org.trustTier}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Sharing matrix */}
                  {groupOrgs.length > 1 && (
                    <div className="overflow-x-auto">
                      <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        Sharing (row → column)
                      </p>
                      <table className="text-[11px] border-collapse">
                        <thead>
                          <tr>
                            <th className="text-left pr-3 pb-1" style={{ color: 'var(--text-muted)' }} />
                            {groupOrgs.map(to => (
                              <th key={to.id} className="text-left pr-3 pb-1 font-normal" style={{ color: 'var(--text-muted)' }}>
                                {to.name}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {groupOrgs.map(from => (
                            <tr key={from.id}>
                              <td className="pr-3 py-1" style={{ color: 'var(--text-secondary)' }}>{from.name}</td>
                              {groupOrgs.map(to => {
                                const mode = modeFor(from.id, to.id)
                                const disabled = from.id === to.id
                                return (
                                  <td key={to.id} className="pr-3 py-1">
                                    <select
                                      value={mode}
                                      disabled={disabled}
                                      onChange={e =>
                                        sharingMutation.mutate({
                                          groupId: group.id,
                                          fromOrgId: from.id,
                                          toOrgId: to.id,
                                          mode: e.target.value as SharingMode,
                                        })
                                      }
                                      className="text-[10px] rounded px-1 py-0.5"
                                      style={{
                                        background: 'var(--bg-void)',
                                        color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
                                        border: '1px solid var(--border)',
                                        opacity: disabled ? 0.5 : 1,
                                      }}
                                    >
                                      {SHARING_MODES.map(m => (
                                        <option key={m} value={m}>{m}</option>
                                      ))}
                                    </select>
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
