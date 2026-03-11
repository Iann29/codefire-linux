import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Trash2, Database, KeyRound, AlertTriangle, CheckCircle, Clock, Zap, Bot, Sparkles, Moon, Plus, X, Route, Star } from 'lucide-react'
import type { AppConfig, Project, IndexState, ModelRoutingRule, AIProviderType } from '@shared/models'
import { api } from '../../lib/api'
import { Section, TextInput, Select, Toggle, NumberInput, Slider } from './SettingsField'

// ─── Constants ────────────────────────────────────────────────────────────

/** Provider brand colors and icons for visual identity */
const PROVIDER_BRANDING: Record<string, { icon: typeof Bot; color: string; label: string }> = {
  'claude-subscription': { icon: Sparkles, color: 'text-orange-400', label: 'Claude' },
  'openai-subscription': { icon: Bot, color: 'text-green-400', label: 'OpenAI' },
  'gemini-subscription': { icon: Zap, color: 'text-blue-400', label: 'Gemini' },
  'kimi-subscription': { icon: Moon, color: 'text-purple-400', label: 'Kimi' },
}

/** All subscription providers that can be connected */
const SUBSCRIPTION_PROVIDERS: { id: string; label: string }[] = [
  { id: 'claude-subscription', label: 'Claude (Anthropic)' },
  { id: 'openai-subscription', label: 'OpenAI (ChatGPT Plus/Pro)' },
  { id: 'gemini-subscription', label: 'Gemini (Google)' },
  { id: 'kimi-subscription', label: 'Kimi (Moonshot)' },
]

/** Providers that use direct token input instead of OAuth browser flow */
const TOKEN_INPUT_PROVIDERS: Record<string, { hint: string }> = {
  'claude-subscription': {
    hint: 'Run "claude setup-token" in your terminal, then paste the sk-ant-oat01-... token here.',
  },
}

const PROVIDER_OPTIONS: { value: AIProviderType; label: string }[] = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom', label: 'Custom Endpoint' },
  { value: 'claude-subscription', label: 'Claude' },
  { value: 'openai-subscription', label: 'OpenAI' },
  { value: 'gemini-subscription', label: 'Gemini' },
  { value: 'kimi-subscription', label: 'Kimi' },
]

// ─── Types ────────────────────────────────────────────────────────────────

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

interface AccountEntry {
  providerId: string
  accountIndex: number
  accountEmail: string | null
  accountName: string | null
  subscriptionTier: string | null
  expiresAt: number
  isExpired: boolean
  needsRefresh: boolean
}

// ─── Utility helpers ──────────────────────────────────────────────────────

function formatRelativeTime(timestampMs: number): string {
  const now = Date.now()
  const diffMs = timestampMs - now
  const absDiffMs = Math.abs(diffMs)
  const isFuture = diffMs > 0

  const minutes = Math.floor(absDiffMs / 60_000)
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  let timeStr: string
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    timeStr = `${days}d`
  } else if (hours > 0) {
    timeStr = remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
  } else if (minutes > 0) {
    timeStr = `${minutes}min`
  } else {
    timeStr = isFuture ? 'less than 1min' : 'just now'
  }

  if (minutes === 0) return timeStr
  return isFuture ? `in ${timeStr}` : `${timeStr} ago`
}

function getTokenStatus(account: AccountEntry) {
  if (account.isExpired) {
    return { label: 'Token expired', color: 'text-red-400', icon: AlertTriangle, severity: 'expired' as const }
  }
  if (account.needsRefresh) {
    return { label: 'Needs refresh', color: 'text-yellow-400', icon: Clock, severity: 'refresh' as const }
  }
  return { label: 'Token valid', color: 'text-green-400', icon: CheckCircle, severity: 'valid' as const }
}

// ─── Index Status Panel ───────────────────────────────────────────────────

function IndexStatusPanel() {
  const [projects, setProjects] = useState<Project[]>([])
  const [indexStates, setIndexStates] = useState<Map<string, IndexState | null>>(new Map())
  const [loading, setLoading] = useState(true)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const projectList = await api.projects.list()
    const display = projectList.filter((p) => p.id !== '__global__')
    setProjects(display)

    const states = new Map<string, IndexState | null>()
    await Promise.all(
      display.map(async (p) => {
        const state = await api.search.getIndexState(p.id).catch(() => null)
        states.set(p.id, state)
      })
    )
    setIndexStates(states)
    setLoading(false)
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  async function handleReindex(projectId: string) {
    setActionInProgress(projectId)
    await api.search.reindex(projectId).catch(() => {})
    setTimeout(async () => {
      const state = await api.search.getIndexState(projectId).catch(() => null)
      setIndexStates((prev) => new Map(prev).set(projectId, state))
      setActionInProgress(null)
    }, 1000)
  }

  async function handleClear(projectId: string) {
    setActionInProgress(projectId)
    await api.search.clearIndex(projectId).catch(() => {})
    const state = await api.search.getIndexState(projectId).catch(() => null)
    setIndexStates((prev) => new Map(prev).set(projectId, state))
    setActionInProgress(null)
  }

  if (loading) return <p className="text-[10px] text-neutral-600">Loading index status...</p>
  if (projects.length === 0) return <p className="text-[10px] text-neutral-600">No projects to index.</p>

  return (
    <div className="space-y-1.5">
      {projects.map((p) => {
        const state = indexStates.get(p.id)
        const status = state?.status ?? 'idle'
        const chunks = state?.totalChunks ?? 0
        const isActive = actionInProgress === p.id
        const name = p.name.split(/[/\\]/).pop() ?? p.name

        return (
          <div key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700">
            <Database size={12} className="text-neutral-500 shrink-0" />
            <span className="text-xs text-neutral-300 truncate flex-1" title={p.name}>{name}</span>
            <span className={`text-[10px] font-mono shrink-0 ${
              status === 'idle' ? 'text-neutral-600' :
              status === 'indexing' ? 'text-codefire-orange' :
              status === 'error' ? 'text-red-400' : 'text-green-400'
            }`}>
              {status === 'idle' ? 'Not indexed' :
               status === 'indexing' ? 'Indexing...' :
               status === 'error' ? 'Error' :
               `${chunks} chunks`}
            </span>
            <button type="button" onClick={() => handleReindex(p.id)} disabled={isActive}
              className="text-neutral-500 hover:text-codefire-orange transition-colors disabled:opacity-30" title="Rebuild index">
              <RefreshCw size={12} className={isActive ? 'animate-spin' : ''} />
            </button>
            <button type="button" onClick={() => handleClear(p.id)} disabled={isActive}
              className="text-neutral-500 hover:text-red-400 transition-colors disabled:opacity-30" title="Clear index">
              <Trash2 size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Provider Card (single subscription provider) ─────────────────────────

function ProviderCard({
  providerId,
  accounts,
  isPrimary,
  onSetPrimary,
  onAccountsChanged,
}: {
  providerId: string
  accounts: AccountEntry[]
  isPrimary: boolean
  onSetPrimary: () => void
  onAccountsChanged: () => void
}) {
  const branding = PROVIDER_BRANDING[providerId]
  const BrandIcon = branding?.icon ?? Bot
  const brandColor = branding?.color ?? 'text-neutral-400'
  const tokenInputConfig = TOKEN_INPUT_PROVIDERS[providerId]

  const [connecting, setConnecting] = useState(false)
  const [awaitingCode, setAwaitingCode] = useState(false)
  const [pasteCode, setPasteCode] = useState('')
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [tokenValue, setTokenValue] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  async function handleAddAccount() {
    if (tokenInputConfig) {
      setShowTokenInput(true)
      setTokenValue('')
      setSubmitError(null)
      return
    }
    setConnecting(true)
    setAwaitingCode(false)
    setPasteCode('')
    setSubmitError(null)
    try {
      const result = await api.provider.startOAuth(providerId)
      if (result.awaitingCode) {
        setAwaitingCode(true)
        setConnecting(false)
        return
      }
      onAccountsChanged()
    } catch {
      // ignore
    } finally {
      if (!awaitingCode) setConnecting(false)
    }
  }

  async function handleSubmitToken() {
    if (!tokenValue.trim()) return
    setConnecting(true)
    setSubmitError(null)
    try {
      const result = await api.provider.saveDirectToken(providerId, tokenValue.trim())
      if (result.success) {
        setShowTokenInput(false)
        setTokenValue('')
        onAccountsChanged()
      } else {
        setSubmitError(result.error || 'Failed to save token')
      }
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  async function handleSubmitCode() {
    if (!pasteCode.trim()) return
    setConnecting(true)
    setSubmitError(null)
    try {
      const result = await api.provider.submitOAuthCode(providerId, pasteCode.trim())
      if (result.success) {
        setAwaitingCode(false)
        setPasteCode('')
        onAccountsChanged()
      } else {
        setSubmitError(result.error || 'Failed to authenticate')
      }
    } catch (err) {
      setSubmitError((err as Error).message)
    } finally {
      setConnecting(false)
    }
  }

  async function handleRemoveAccount(accountIndex: number) {
    try {
      await api.provider.removeAccount(providerId, accountIndex)
      onAccountsChanged()
    } catch {}
  }

  return (
    <div className={`px-3 py-2.5 rounded-lg border space-y-2 transition-colors ${
      isPrimary
        ? 'bg-neutral-800 border-codefire-orange/40'
        : 'bg-neutral-800/60 border-neutral-700'
    }`}>
      {/* Header */}
      <div className="flex items-center gap-2">
        <BrandIcon size={16} className={brandColor} />
        <span className={`text-xs font-semibold ${brandColor}`}>{branding?.label ?? providerId}</span>
        {accounts.length > 1 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/20">
            Round-robin: {accounts.length}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {isPrimary ? (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-codefire-orange/15 text-codefire-orange border border-codefire-orange/30 font-medium flex items-center gap-1">
              <Star size={8} className="fill-current" />
              Primary
            </span>
          ) : (
            <button
              type="button"
              onClick={onSetPrimary}
              className="text-[9px] px-1.5 py-0.5 rounded-full border border-neutral-700 text-neutral-500
                         hover:text-neutral-300 hover:border-neutral-500 transition-colors flex items-center gap-1"
              title="Set as primary provider"
            >
              <Star size={8} />
              Set primary
            </button>
          )}
        </div>
      </div>

      {/* Account list */}
      {accounts.length > 0 && (
        <div className="space-y-1.5">
          {accounts.map((account) => {
            const status = getTokenStatus(account)
            const StatusIcon = status.icon
            const expiryText = account.expiresAt ? formatRelativeTime(account.expiresAt) : null

            return (
              <div key={account.accountIndex}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-neutral-900/50 border border-neutral-700/50">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] text-neutral-300 truncate">
                      {account.accountEmail || account.accountName || `Account ${account.accountIndex + 1}`}
                    </span>
                    {account.subscriptionTier && (
                      <span className="text-[8px] px-1 py-0.5 rounded bg-purple-500/15 text-purple-300 border border-purple-500/20 shrink-0">
                        {account.subscriptionTier}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    <StatusIcon size={9} className={status.color} />
                    <span className={`text-[9px] ${status.color}`}>{status.label}</span>
                    {expiryText && status.severity === 'valid' && (
                      <>
                        <span className="text-[9px] text-neutral-600">·</span>
                        <span className="text-[9px] text-neutral-500">expires {expiryText}</span>
                      </>
                    )}
                    {expiryText && status.severity === 'expired' && (
                      <>
                        <span className="text-[9px] text-neutral-600">·</span>
                        <span className="text-[9px] text-red-400">{expiryText}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button type="button" onClick={handleAddAccount}
                    className="text-neutral-500 hover:text-neutral-300 transition-colors p-0.5" title="Update token">
                    <KeyRound size={11} />
                  </button>
                  <button type="button" onClick={() => handleRemoveAccount(account.accountIndex)}
                    className="text-neutral-500 hover:text-red-400 transition-colors p-0.5" title="Remove this account">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Direct token input (Claude) */}
      {showTokenInput && (
        <div className="space-y-1.5 p-2 rounded bg-neutral-900/60 border border-codefire-orange/30">
          <p className="text-[10px] text-neutral-300">{tokenInputConfig?.hint}</p>
          <div className="flex gap-1.5">
            <input type="password" value={tokenValue}
              onChange={(e) => setTokenValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitToken()}
              placeholder="sk-ant-oat01-..."
              className="flex-1 px-2 py-1 text-[11px] bg-neutral-800 border border-neutral-600 rounded text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-codefire-orange font-mono"
              autoFocus />
            <button type="button" onClick={handleSubmitToken}
              disabled={connecting || !tokenValue.trim()}
              className="px-2.5 py-1 text-[10px] font-medium rounded bg-codefire-orange text-white hover:bg-codefire-orange/80 disabled:opacity-40 transition-colors">
              {connecting ? 'Saving...' : 'Save'}
            </button>
            <button type="button"
              onClick={() => { setShowTokenInput(false); setTokenValue(''); setSubmitError(null) }}
              className="px-1.5 py-1 text-neutral-500 hover:text-neutral-300 transition-colors" title="Cancel">
              <X size={12} />
            </button>
          </div>
          {submitError && <p className="text-[9px] text-red-400">{submitError}</p>}
        </div>
      )}

      {/* Code-copy flow */}
      {awaitingCode && (
        <div className="space-y-1.5 p-2 rounded bg-neutral-900/60 border border-codefire-orange/30">
          <p className="text-[10px] text-neutral-300">
            A browser window opened. After you authorize, copy the code and paste it here:
          </p>
          <div className="flex gap-1.5">
            <input type="text" value={pasteCode}
              onChange={(e) => setPasteCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitCode()}
              placeholder="Paste authorization code..."
              className="flex-1 px-2 py-1 text-[11px] bg-neutral-800 border border-neutral-600 rounded text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-codefire-orange"
              autoFocus />
            <button type="button" onClick={handleSubmitCode}
              disabled={connecting || !pasteCode.trim()}
              className="px-2.5 py-1 text-[10px] font-medium rounded bg-codefire-orange text-white hover:bg-codefire-orange/80 disabled:opacity-40 transition-colors">
              {connecting ? 'Verifying...' : 'Submit'}
            </button>
            <button type="button"
              onClick={() => { setAwaitingCode(false); setPasteCode(''); setSubmitError(null) }}
              className="px-1.5 py-1 text-neutral-500 hover:text-neutral-300 transition-colors" title="Cancel">
              <X size={12} />
            </button>
          </div>
          {submitError && <p className="text-[9px] text-red-400">{submitError}</p>}
        </div>
      )}

      {/* Connecting state */}
      {connecting && !awaitingCode && !showTokenInput && (
        <p className="text-[10px] text-codefire-orange">Authenticating...</p>
      )}

      {/* Add account button */}
      {!showTokenInput && (
        <button type="button" onClick={handleAddAccount} disabled={connecting}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-neutral-700
                     text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors disabled:opacity-50">
          <Plus size={10} />
          {accounts.length > 0
            ? (tokenInputConfig ? 'Add another token' : 'Add another account')
            : (tokenInputConfig ? 'Paste setup token' : 'Connect account')}
        </button>
      )}
    </div>
  )
}

// ─── Add Provider Picker ──────────────────────────────────────────────────

function AddProviderPicker({
  connectedProviderIds,
  onSelect,
}: {
  connectedProviderIds: Set<string>
  onSelect: (providerId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const available = SUBSCRIPTION_PROVIDERS.filter((p) => !connectedProviderIds.has(p.id))

  if (available.length === 0) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-[10px] px-3 py-1.5 rounded-lg border border-dashed border-neutral-600
                   text-neutral-400 hover:text-neutral-200 hover:border-neutral-500 transition-colors w-full justify-center"
      >
        <Plus size={12} />
        Add provider
      </button>
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          {/* Menu */}
          <div className="absolute top-full left-0 right-0 mt-1 z-20 bg-neutral-800 border border-neutral-700 rounded-lg shadow-xl overflow-hidden">
            {available.map((p) => {
              const branding = PROVIDER_BRANDING[p.id]
              const BrandIcon = branding?.icon ?? Bot
              const brandColor = branding?.color ?? 'text-neutral-400'

              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onSelect(p.id); setOpen(false) }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-neutral-700/50 transition-colors"
                >
                  <BrandIcon size={14} className={brandColor} />
                  <span className="text-xs text-neutral-300">{p.label}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Model Routing Panel ──────────────────────────────────────────────────

function ModelRoutingPanel({ rules, onChange }: { rules: ModelRoutingRule[]; onChange: (rules: ModelRoutingRule[]) => void }) {
  function addRule() {
    onChange([...rules, { pattern: '', provider: 'openrouter', label: '' }])
  }

  function removeRule(index: number) {
    onChange(rules.filter((_, i) => i !== index))
  }

  function updateRule(index: number, patch: Partial<ModelRoutingRule>) {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  return (
    <div className="space-y-2">
      {rules.length > 0 && (
        <div className="space-y-1.5">
          {rules.map((rule, i) => (
            <div key={i} className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700">
              <input type="text" value={rule.pattern}
                onChange={(e) => updateRule(i, { pattern: e.target.value })}
                placeholder="claude-opus*"
                className="w-36 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-600 font-mono focus:outline-none focus:border-codefire-orange/50"
                title="Pattern (model ID prefix)" />
              <select value={rule.provider}
                onChange={(e) => updateRule(i, { provider: e.target.value as AIProviderType })}
                className="w-36 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-[11px] text-neutral-200 focus:outline-none focus:border-codefire-orange/50">
                {PROVIDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input type="text" value={rule.label}
                onChange={(e) => updateRule(i, { label: e.target.value })}
                placeholder="Opus via Claude Max"
                className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 rounded px-2 py-1 text-[11px] text-neutral-200 placeholder:text-neutral-600 focus:outline-none focus:border-codefire-orange/50"
                title="Description" />
              <button type="button" onClick={() => removeRule(i)}
                className="text-neutral-600 hover:text-red-400 transition-colors shrink-0 p-0.5" title="Remove rule">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={addRule}
        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-neutral-700 text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors">
        <Plus size={10} />
        Add rule
      </button>
    </div>
  )
}

// ─── Primary star button for OpenRouter / Custom ──────────────────────────

function PrimaryBadge({ isPrimary, onClick }: { isPrimary: boolean; onClick: () => void }) {
  if (isPrimary) {
    return (
      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-codefire-orange/15 text-codefire-orange border border-codefire-orange/30 font-medium flex items-center gap-1 shrink-0">
        <Star size={8} className="fill-current" />
        Primary
      </span>
    )
  }
  return (
    <button type="button" onClick={onClick}
      className="text-[9px] px-1.5 py-0.5 rounded-full border border-neutral-700 text-neutral-500
                 hover:text-neutral-300 hover:border-neutral-500 transition-colors flex items-center gap-1 shrink-0"
      title="Set as primary provider">
      <Star size={8} />
      Set primary
    </button>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────

export default function SettingsTabEngine({ config, onChange }: Props) {
  const [allAccounts, setAllAccounts] = useState<AccountEntry[]>([])
  const [addingProvider, setAddingProvider] = useState<string | null>(null)

  const loadAccounts = useCallback(async () => {
    try {
      const accounts = await api.provider.listAccounts()
      setAllAccounts(accounts ?? [])
    } catch {
      // keep current
    }
  }, [])

  useEffect(() => { loadAccounts() }, [loadAccounts])

  // Group accounts by providerId
  const accountsByProvider = new Map<string, AccountEntry[]>()
  for (const account of allAccounts) {
    const list = accountsByProvider.get(account.providerId) || []
    list.push(account)
    accountsByProvider.set(account.providerId, list)
  }

  // Connected subscription provider IDs (those with at least 1 account)
  const connectedProviderIds = new Set(accountsByProvider.keys())

  // Also include provider being actively added (even if no accounts yet)
  if (addingProvider && !connectedProviderIds.has(addingProvider)) {
    connectedProviderIds.add(addingProvider)
    accountsByProvider.set(addingProvider, [])
  }

  // Check if OpenRouter or Custom are configured
  const hasOpenRouter = !!(config.openRouterKey?.trim())
  const hasCustom = !!(config.customEndpointUrl?.trim())

  // Determine if Claude is connected (for effort level option)
  const claudeConnected = accountsByProvider.has('claude-subscription')

  function handleSetPrimary(providerId: AIProviderType) {
    onChange({ aiProvider: providerId })
  }

  function handleAddProvider(providerId: string) {
    setAddingProvider(providerId)
  }

  return (
    <div className="space-y-6">
      {/* ─── Connected Providers ──────────────────────────────────────── */}
      <Section title="Connected Providers">
        {connectedProviderIds.size === 0 && !hasOpenRouter && !hasCustom && (
          <p className="text-[10px] text-neutral-500 py-2">
            No providers connected yet. Add a provider to get started.
          </p>
        )}

        <div className="space-y-2">
          {/* Subscription provider cards */}
          {SUBSCRIPTION_PROVIDERS.filter((p) => connectedProviderIds.has(p.id)).map((p) => (
            <ProviderCard
              key={p.id}
              providerId={p.id}
              accounts={accountsByProvider.get(p.id) ?? []}
              isPrimary={config.aiProvider === p.id}
              onSetPrimary={() => handleSetPrimary(p.id as AIProviderType)}
              onAccountsChanged={() => {
                loadAccounts()
                setAddingProvider(null)
              }}
            />
          ))}

          {/* Add provider picker */}
          <AddProviderPicker
            connectedProviderIds={connectedProviderIds}
            onSelect={handleAddProvider}
          />
        </div>
      </Section>

      {/* ─── OpenRouter ──────────────────────────────────────────────── */}
      <Section title="OpenRouter">
        <div className={`px-3 py-2.5 rounded-lg border space-y-2 ${
          config.aiProvider === 'openrouter'
            ? 'bg-neutral-800 border-codefire-orange/40'
            : 'bg-neutral-800/60 border-neutral-700'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-300 font-medium">API Key</span>
              {hasOpenRouter && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                  Configured
                </span>
              )}
            </div>
            <PrimaryBadge
              isPrimary={config.aiProvider === 'openrouter'}
              onClick={() => handleSetPrimary('openrouter')}
            />
          </div>
          <TextInput
            label=""
            hint="Used for chat, embeddings, and image generation. Get one at openrouter.ai"
            placeholder="sk-or-..."
            value={config.openRouterKey}
            onChange={(v) => onChange({ openRouterKey: v })}
            secret
          />
        </div>
      </Section>

      {/* ─── Custom Endpoint ─────────────────────────────────────────── */}
      <Section title="Custom Endpoint">
        <div className={`px-3 py-2.5 rounded-lg border space-y-2 ${
          config.aiProvider === 'custom'
            ? 'bg-neutral-800 border-codefire-orange/40'
            : 'bg-neutral-800/60 border-neutral-700'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-neutral-300 font-medium">OpenAI-compatible API</span>
              {hasCustom && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
                  Configured
                </span>
              )}
            </div>
            <PrimaryBadge
              isPrimary={config.aiProvider === 'custom'}
              onClick={() => handleSetPrimary('custom')}
            />
          </div>
          <TextInput
            label="Endpoint URL"
            hint="Works with CLIProxyAPI, Ollama, LM Studio, LiteLLM, etc."
            placeholder="http://localhost:8080/v1"
            value={config.customEndpointUrl}
            onChange={(v) => onChange({ customEndpointUrl: v })}
          />
          <TextInput
            label="API Key (optional)"
            hint="Leave empty if your endpoint doesn't require authentication."
            placeholder="sk-..."
            value={config.customEndpointKey}
            onChange={(v) => onChange({ customEndpointKey: v })}
            secret
          />
        </div>
      </Section>

      {/* ─── Fallback + Provider-specific settings ───────────────────── */}
      <Section title="Fallback & Routing">
        <Select
          label="Fallback provider"
          hint="If the primary provider fails (429 rate limit, 5xx errors), automatically retry with the fallback."
          value={config.fallbackProvider || 'openrouter'}
          onChange={(v) => onChange({ fallbackProvider: v as 'openrouter' | 'none' })}
          options={[
            { value: 'openrouter', label: 'OpenRouter (requires API key)' },
            { value: 'none', label: 'None — no fallback' },
          ]}
        />

        {claudeConnected && (
          <Select
            label="Claude effort"
            hint="Controls Claude subscription reasoning intensity on supported Claude models (currently Opus 4.6 and Sonnet 4.6). Low is faster, medium is balanced, high spends more time thinking. Default lets Claude choose."
            value={config.chatEffortLevel || 'default'}
            onChange={(v) => onChange({ chatEffortLevel: v as AppConfig['chatEffortLevel'] })}
            options={[
              { value: 'default', label: 'Default' },
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
          />
        )}
      </Section>

      {/* ─── Models ──────────────────────────────────────────────────── */}
      <Section title="Models">
        <Select
          label="Embedding model"
          hint="Model used for semantic code search. Gemini Embedding 2 requires a Google AI API key. Changing model requires re-indexing projects."
          value={config.embeddingModel}
          onChange={(v) => onChange({ embeddingModel: v })}
          options={[
            { value: 'openai/text-embedding-3-small', label: 'text-embedding-3-small (OpenAI via OpenRouter)' },
            { value: 'openai/text-embedding-3-large', label: 'text-embedding-3-large (OpenAI via OpenRouter)' },
            { value: 'google/gemini-embedding-2', label: 'Gemini Embedding 2 (Google)' },
          ]}
        />
        {config.embeddingModel?.startsWith('google/') && (
          <TextInput
            label="Google AI API Key"
            hint="Required for Gemini embedding models. Get one free at ai.google.dev"
            placeholder="AIza..."
            value={config.googleAiApiKey}
            onChange={(v) => onChange({ googleAiApiKey: v })}
            secret
          />
        )}
        <Select
          label="Chat model"
          hint="Model used for summaries and briefings"
          value={config.chatModel}
          onChange={(v) => onChange({ chatModel: v })}
          options={[
            { value: 'anthropic/claude-opus-4-6', label: 'Claude Opus 4.6' },
            { value: 'anthropic/claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
            { value: 'anthropic/claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
            { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro' },
            { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash' },
            { value: 'openai/gpt-5.4', label: 'GPT-5.4' },
            { value: 'qwen/qwen3.5-plus-02-15', label: 'Qwen 3.5 Plus' },
            { value: 'qwen/qwen3-coder-next', label: 'Qwen3 Coder Next' },
            { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2' },
            { value: 'minimax/minimax-m2.5', label: 'MiniMax M2.5' },
            { value: 'z-ai/glm-5', label: 'GLM-5' },
            { value: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5' },
          ]}
        />
        <Select
          label="Chat mode"
          hint="Context: low cost, RAG-enhanced Q&A. Agent: full tool calling, can take actions."
          value={config.chatMode || 'context'}
          onChange={(v) => onChange({ chatMode: v as 'context' | 'agent' })}
          options={[
            { value: 'context', label: 'Context (low cost)' },
            { value: 'agent', label: 'Agent (tool calling)' },
          ]}
        />
      </Section>

      {/* ─── Agent Runtime ───────────────────────────────────────────── */}
      <Section title="Agent Runtime">
        <NumberInput
          label="Max tool calls per run"
          hint="Hard cap for tool-calling loop in agent mode."
          value={config.agentMaxToolCalls}
          onChange={(v) => onChange({ agentMaxToolCalls: Number.isFinite(v) ? Math.max(1, Math.min(100, Math.round(v))) : 30 })}
          min={1}
          max={100}
          step={1}
        />
        <Slider
          label="Agent temperature"
          hint="Lower values are more deterministic. Higher values are more exploratory."
          value={config.agentTemperature}
          onChange={(v) => onChange({ agentTemperature: Math.max(0, Math.min(1, Number(v.toFixed(1)))) })}
          min={0}
          max={1}
          step={0.1}
        />
        <Toggle
          label="Plan enforcement"
          hint="Requires set_plan before browser actions and verification before next action."
          value={config.agentPlanEnforcement}
          onChange={(v) => onChange({ agentPlanEnforcement: v })}
        />
        <Toggle
          label="Context compaction (preview)"
          hint="Automatically summarizes older messages when context window fills up, keeping recent context while preserving key decisions."
          value={config.agentContextCompaction}
          onChange={(v) => onChange({ agentContextCompaction: v })}
        />
      </Section>

      {/* ─── Model Routing ───────────────────────────────────────────── */}
      <Section title="Model Routing">
        <p className="text-[10px] text-neutral-600 mb-1">
          Route specific models to specific providers. Pattern matches model ID prefix.
          First matching rule wins. If no rule matches, the primary provider is used.
        </p>
        <div className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded bg-neutral-800/50 border border-neutral-700/50">
          <Route size={12} className="text-neutral-500 shrink-0" />
          <p className="text-[10px] text-neutral-500">
            Examples: "claude-opus*" to route Opus models, "gpt-*" for all GPT models, "llama*" for local models.
          </p>
        </div>
        <ModelRoutingPanel
          rules={config.modelRouting || []}
          onChange={(rules) => onChange({ modelRouting: rules })}
        />
      </Section>

      {/* ─── Browser Security ────────────────────────────────────────── */}
      <Section title="Browser Security">
        <TextInput
          label="Allowed domains"
          hint="Comma-separated list of domains the browser agent can navigate to. Leave empty to allow all (except blocked defaults like banking, admin, localhost)."
          placeholder="example.com, docs.myapp.io"
          value={(config.browserAllowedDomains || []).join(', ')}
          onChange={(v) => onChange({
            browserAllowedDomains: v
              .split(',')
              .map((d) => d.trim())
              .filter(Boolean),
          })}
        />
        <p className="text-[10px] text-neutral-600 px-0.5">
          Default blocklist: localhost, banking sites, cloud consoles, payment processors.
          The agent will refuse to navigate to blocked domains.
        </p>
        <Toggle
          label="Confirm destructive actions"
          hint="Ask for confirmation before clicks, typing, and form fills in the browser agent."
          value={config.browserConfirmDestructive}
          onChange={(v) => onChange({ browserConfirmDestructive: v })}
        />
      </Section>

      {/* ─── Automation ──────────────────────────────────────────────── */}
      <Section title="Automation">
        <Toggle
          label="Semantic code search"
          hint="Enable vector-based code search across projects"
          value={config.contextSearchEnabled}
          onChange={(v) => onChange({ contextSearchEnabled: v })}
        />
        <Toggle
          label="Auto-snapshot sessions"
          value={config.autoSnapshotSessions}
          onChange={(v) => onChange({ autoSnapshotSessions: v })}
        />
        <Toggle
          label="Auto-update codebase tree"
          value={config.autoUpdateCodebaseTree}
          onChange={(v) => onChange({ autoUpdateCodebaseTree: v })}
        />
        <Toggle
          label="Instruction injection"
          hint="Inject .claude/instructions.md into CLI sessions"
          value={config.instructionInjection}
          onChange={(v) => onChange({ instructionInjection: v })}
        />
        <NumberInput
          label="Snapshot debounce (seconds)"
          value={config.snapshotDebounce}
          onChange={(v) => onChange({ snapshotDebounce: v })}
          min={5}
          max={120}
          step={5}
        />
      </Section>

      {/* ─── Index Status ────────────────────────────────────────────── */}
      <Section title="Index Status">
        <p className="text-[10px] text-neutral-600 mb-2">
          Semantic code index for each project. Rebuild to re-index all files, or clear to remove index data.
        </p>
        <IndexStatusPanel />
      </Section>
    </div>
  )
}
