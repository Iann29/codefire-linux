import { useState, useEffect, useCallback } from 'react'
import { Shield, Gift, Globe, Trash2, Loader2, AlertCircle, Plus } from 'lucide-react'
import type { AppConfig } from '@shared/models'
import type { TeamGrant } from '@shared/premium-models'
import { Section, TextInput, Select } from './SettingsField'
import { api } from '../../lib/api'

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

const GRANT_TYPE_OPTIONS = [
  { value: 'oss_project', label: 'OSS Project' },
  { value: 'oss_contributor', label: 'OSS Contributor' },
  { value: 'custom', label: 'Custom' },
]

const PLAN_TIER_OPTIONS = [
  { value: 'starter', label: 'Starter' },
  { value: 'agency', label: 'Agency' },
]

function GrantTypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    oss_project: 'bg-green-500/15 text-green-400 border-green-500/30',
    oss_contributor: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
    custom: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  }
  const labels: Record<string, string> = {
    oss_project: 'OSS Project',
    oss_contributor: 'OSS Contributor',
    custom: 'Custom',
  }
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border ${styles[type] || styles.custom}`}>
      {labels[type] || type}
    </span>
  )
}

export default function SettingsTabAdmin({ config: _config, onChange: _onChange }: Props) {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [grants, setGrants] = useState<TeamGrant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Form state
  const [teamId, setTeamId] = useState('')
  const [grantType, setGrantType] = useState('oss_project')
  const [planTier, setPlanTier] = useState('starter')
  const [seatLimit, setSeatLimit] = useState('')
  const [projectLimit, setProjectLimit] = useState('')
  const [repoUrl, setRepoUrl] = useState('')
  const [note, setNote] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  const loadGrants = useCallback(async () => {
    try {
      const data = await api.premium.listGrants()
      setGrants(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load grants')
    }
  }, [])

  useEffect(() => {
    async function init() {
      setLoading(true)
      try {
        const admin = await api.premium.isSuperAdmin()
        setIsAdmin(admin)
        if (admin) {
          await loadGrants()
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to check admin status')
        setIsAdmin(false)
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [loadGrants])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-neutral-500" />
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <Section title="Admin Panel">
          <div className="flex items-center gap-2 py-8 justify-center">
            <Shield className="w-5 h-5 text-neutral-600" />
            <p className="text-xs text-neutral-500">You don't have admin access</p>
          </div>
        </Section>
      </div>
    )
  }

  function resetForm() {
    setTeamId('')
    setGrantType('oss_project')
    setPlanTier('starter')
    setSeatLimit('')
    setProjectLimit('')
    setRepoUrl('')
    setNote('')
    setExpiresAt('')
  }

  async function handleCreateGrant() {
    if (!teamId) return
    setSubmitting(true)
    setError(null)
    try {
      await api.premium.createGrant({
        teamId,
        grantType,
        planTier,
        seatLimit: seatLimit ? parseInt(seatLimit, 10) : undefined,
        projectLimit: projectLimit ? parseInt(projectLimit, 10) : undefined,
        repoUrl: repoUrl || undefined,
        note: note || undefined,
        expiresAt: expiresAt || undefined,
      })
      resetForm()
      setShowForm(false)
      await loadGrants()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create grant')
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRevoke(grantId: string) {
    setError(null)
    try {
      await api.premium.revokeGrant(grantId)
      await loadGrants()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke grant')
    }
  }

  return (
    <div className="space-y-6">
      <Section title="Super Admin Panel">
        <div className="flex items-center gap-2 text-[10px] text-neutral-500">
          <Shield className="w-3.5 h-3.5 text-codefire-orange" />
          <span>Manage OSS grants and free premium access</span>
        </div>
      </Section>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-400">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Active Grants */}
      <Section title={`Active Grants (${grants.length})`}>
        {grants.length === 0 ? (
          <p className="text-xs text-neutral-600 py-2">No grants yet</p>
        ) : (
          <div className="space-y-1">
            {grants.map((grant) => (
              <div
                key={grant.id}
                className="flex items-start justify-between gap-3 py-2 px-2.5 rounded
                           bg-neutral-800/40 border border-neutral-800 hover:border-neutral-700 transition-colors"
              >
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <GrantTypeBadge type={grant.grantType} />
                    <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-medium">
                      {grant.planTier}
                    </span>
                    {grant.seatLimit && (
                      <span className="text-[10px] text-neutral-600">
                        {grant.seatLimit} seats
                      </span>
                    )}
                    {grant.projectLimit && (
                      <span className="text-[10px] text-neutral-600">
                        {grant.projectLimit} projects
                      </span>
                    )}
                  </div>

                  <div className="text-[10px] text-neutral-500 truncate">
                    Team: <span className="text-neutral-400 font-mono">{grant.teamId}</span>
                  </div>

                  {grant.repoUrl && (
                    <div className="flex items-center gap-1 text-[10px] text-neutral-500">
                      <Globe className="w-3 h-3 shrink-0" />
                      <span className="truncate text-neutral-400">{grant.repoUrl}</span>
                    </div>
                  )}

                  {grant.note && (
                    <p className="text-[10px] text-neutral-600 italic truncate">{grant.note}</p>
                  )}

                  <div className="flex items-center gap-2 text-[9px] text-neutral-600">
                    <span>Created {new Date(grant.createdAt).toLocaleDateString()}</span>
                    {grant.expiresAt && (
                      <>
                        <span>•</span>
                        <span className={new Date(grant.expiresAt) < new Date() ? 'text-red-500' : ''}>
                          Expires {new Date(grant.expiresAt).toLocaleDateString()}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <button
                  onClick={() => handleRevoke(grant.id)}
                  className="p-1 text-neutral-600 hover:text-red-400 transition-colors shrink-0 mt-0.5"
                  title="Revoke grant"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* New Grant */}
      <Section title="New Grant">
        {!showForm ? (
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs
                       bg-codefire-orange/20 text-codefire-orange hover:bg-codefire-orange/30
                       transition-colors font-medium"
          >
            <Gift className="w-3 h-3" />
            Grant Access
          </button>
        ) : (
          <div className="space-y-3 p-3 rounded border border-neutral-700 bg-neutral-800/30">
            <TextInput
              label="Team ID"
              hint="The UUID of the team to grant access to"
              value={teamId}
              onChange={setTeamId}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            />

            <Select
              label="Grant type"
              value={grantType}
              onChange={setGrantType}
              options={GRANT_TYPE_OPTIONS}
            />

            <Select
              label="Plan tier"
              value={planTier}
              onChange={setPlanTier}
              options={PLAN_TIER_OPTIONS}
            />

            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-neutral-500 block mb-1">Seat limit</label>
                <input
                  type="number"
                  value={seatLimit}
                  onChange={(e) => setSeatLimit(e.target.value)}
                  placeholder="Unlimited"
                  min={1}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                             text-xs text-neutral-200 placeholder:text-neutral-600
                             focus:outline-none focus:border-codefire-orange/50"
                />
              </div>
              <div className="flex-1">
                <label className="text-xs text-neutral-500 block mb-1">Project limit</label>
                <input
                  type="number"
                  value={projectLimit}
                  onChange={(e) => setProjectLimit(e.target.value)}
                  placeholder="Unlimited"
                  min={1}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                             text-xs text-neutral-200 placeholder:text-neutral-600
                             focus:outline-none focus:border-codefire-orange/50"
                />
              </div>
            </div>

            {grantType === 'oss_project' && (
              <TextInput
                label="Repository URL"
                hint="The public repo this grant is for"
                value={repoUrl}
                onChange={setRepoUrl}
                placeholder="https://github.com/org/repo"
              />
            )}

            <TextInput
              label="Note"
              hint="Internal note about this grant"
              value={note}
              onChange={setNote}
              placeholder="e.g., Granted for React contributions"
            />

            <div className="space-y-1">
              <label className="text-xs text-neutral-500 block">Expires at</label>
              <p className="text-[10px] text-neutral-600">Leave empty for no expiration</p>
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                className="w-full bg-neutral-800 border border-neutral-700 rounded px-3 py-1.5
                           text-xs text-neutral-200
                           focus:outline-none focus:border-codefire-orange/50"
              />
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={handleCreateGrant}
                disabled={submitting || !teamId}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs
                           bg-codefire-orange/20 text-codefire-orange hover:bg-codefire-orange/30
                           transition-colors font-medium disabled:opacity-50"
              >
                <Plus className="w-3 h-3" />
                {submitting ? 'Granting...' : 'Grant Access'}
              </button>
              <button
                onClick={() => { setShowForm(false); resetForm() }}
                className="px-3 py-1.5 rounded text-xs text-neutral-500 hover:text-neutral-300
                           hover:bg-neutral-800 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </Section>
    </div>
  )
}
