import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Trash2, Database, KeyRound, AlertTriangle, CheckCircle, Clock, Zap, Bot, Sparkles, Moon, Plus, X, Route } from 'lucide-react'
import type { AppConfig, Project, IndexState, ModelRoutingRule, AIProviderType } from '@shared/models'
import { api } from '../../lib/api'
import { Section, TextInput, Select, Toggle, NumberInput, Slider } from './SettingsField'

/** Provider brand colors and icons for visual identity */
const PROVIDER_BRANDING: Record<string, { icon: typeof Bot; color: string; label: string }> = {
  'claude-subscription': { icon: Sparkles, color: 'text-orange-400', label: 'Claude' },
  'openai-subscription': { icon: Bot, color: 'text-green-400', label: 'OpenAI' },
  'gemini-subscription': { icon: Zap, color: 'text-blue-400', label: 'Gemini' },
  'kimi-subscription': { icon: Moon, color: 'text-purple-400', label: 'Kimi' },
}

interface Props {
  config: AppConfig
  onChange: (patch: Partial<AppConfig>) => void
}

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
    // Brief delay then refresh state
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

  if (loading) {
    return <p className="text-[10px] text-neutral-600">Loading index status...</p>
  }

  if (projects.length === 0) {
    return <p className="text-[10px] text-neutral-600">No projects to index.</p>
  }

  return (
    <div className="space-y-1.5">
      {projects.map((p) => {
        const state = indexStates.get(p.id)
        const status = state?.status ?? 'idle'
        const chunks = state?.totalChunks ?? 0
        const isActive = actionInProgress === p.id
        const name = p.name.split(/[/\\]/).pop() ?? p.name

        return (
          <div
            key={p.id}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-neutral-800 border border-neutral-700"
          >
            <Database size={12} className="text-neutral-500 shrink-0" />
            <span className="text-xs text-neutral-300 truncate flex-1" title={p.name}>
              {name}
            </span>
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
            <button
              type="button"
              onClick={() => handleReindex(p.id)}
              disabled={isActive}
              className="text-neutral-500 hover:text-codefire-orange transition-colors disabled:opacity-30"
              title="Rebuild index"
            >
              <RefreshCw size={12} className={isActive ? 'animate-spin' : ''} />
            </button>
            <button
              type="button"
              onClick={() => handleClear(p.id)}
              disabled={isActive}
              className="text-neutral-500 hover:text-red-400 transition-colors disabled:opacity-30"
              title="Clear index"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/**
 * Formats a timestamp as a relative time string (e.g. "in 2h 15m", "5min ago").
 */
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

interface AccountEntry {
  accountIndex: number
  accountEmail: string | null
  accountName: string | null
  subscriptionTier: string | null
  expiresAt: number
  isExpired: boolean
  needsRefresh: boolean
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

/** Providers that use direct token input instead of OAuth browser flow */
const TOKEN_INPUT_PROVIDERS: Record<string, { hint: string }> = {
  'claude-subscription': {
    hint: 'Run "claude setup-token" in your terminal, then paste the sk-ant-oat01-... token here.',
  },
}

function SubscriptionProviderPanel({ provider }: { provider: string }) {
  const branding = PROVIDER_BRANDING[provider]
  const BrandIcon = branding?.icon ?? Bot
  const brandColor = branding?.color ?? 'text-neutral-400'
  const tokenInputConfig = TOKEN_INPUT_PROVIDERS[provider]

  const [accounts, setAccounts] = useState<AccountEntry[]>([])
  const [connecting, setConnecting] = useState(false)
  const [awaitingCode, setAwaitingCode] = useState(false)
  const [pasteCode, setPasteCode] = useState('')
  const [showTokenInput, setShowTokenInput] = useState(false)
  const [tokenValue, setTokenValue] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [, setNow] = useState(Date.now())

  // Update "now" every 30s so relative time stays fresh (triggers re-render for expiry text)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(timer)
  }, [])

  const refreshAccountData = useCallback(async () => {
    try {
      const allAccounts = await api.provider.listAccounts()
      const providerAccounts = allAccounts
        ?.filter((a) => a.providerId === provider)
        .sort((a, b) => a.accountIndex - b.accountIndex)
        ?? []
      setAccounts(providerAccounts)
    } catch {
      // keep current state on error
    }
  }, [provider])

  useEffect(() => { refreshAccountData() }, [refreshAccountData])

  async function handleAddAccount() {
    if (tokenInputConfig) {
      // Direct token flow: show token input
      setShowTokenInput(true)
      setTokenValue('')
      setSubmitError(null)
      return
    }

    // OAuth flow
    setConnecting(true)
    setAwaitingCode(false)
    setPasteCode('')
    setSubmitError(null)
    try {
      const result = await api.provider.startOAuth(provider)
      if (result.awaitingCode) {
        setAwaitingCode(true)
        setConnecting(false)
        return
      }
      await refreshAccountData()
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
      const result = await api.provider.saveDirectToken(provider, tokenValue.trim())
      if (result.success) {
        setShowTokenInput(false)
        setTokenValue('')
        await refreshAccountData()
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
      const result = await api.provider.submitOAuthCode(provider, pasteCode.trim())
      if (result.success) {
        setAwaitingCode(false)
        setPasteCode('')
        await refreshAccountData()
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
      await api.provider.removeAccount(provider, accountIndex)
      await refreshAccountData()
    } catch {}
  }

  async function handleReauthAccount() {
    await handleAddAccount()
  }

  const hasAccounts = accounts.length > 0

  return (
    <div className="px-3 py-2 rounded bg-neutral-800 border border-neutral-700 space-y-2">
      {/* Provider branding header */}
      <div className="flex items-center gap-2 pb-1 border-b border-neutral-700/50">
        <BrandIcon size={16} className={brandColor} />
        <span className={`text-xs font-semibold ${brandColor}`}>{branding?.label ?? provider}</span>
        {accounts.length > 1 && (
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 border border-blue-500/20">
            Round-robin: {accounts.length} accounts
          </span>
        )}
        {hasAccounts && (
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/20">Active</span>
        )}
      </div>

      {/* Account list */}
      {hasAccounts && (
        <div className="space-y-1.5">
          {accounts.map((account) => {
            const status = getTokenStatus(account)
            const StatusIcon = status.icon
            const expiryText = account.expiresAt ? formatRelativeTime(account.expiresAt) : null

            return (
              <div
                key={account.accountIndex}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded bg-neutral-900/50 border border-neutral-700/50"
              >
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
                  <button
                    type="button"
                    onClick={handleReauthAccount}
                    className="text-neutral-500 hover:text-neutral-300 transition-colors p-0.5"
                    title="Update token"
                  >
                    <KeyRound size={11} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRemoveAccount(account.accountIndex)}
                    className="text-neutral-500 hover:text-red-400 transition-colors p-0.5"
                    title="Remove this account"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* No accounts */}
      {!hasAccounts && !connecting && !showTokenInput && (
        <p className="text-[10px] text-neutral-500">
          {tokenInputConfig
            ? 'Not connected — paste a setup token to use your subscription'
            : 'Not connected — sign in to use your subscription'}
        </p>
      )}

      {/* Direct token input flow (Claude) */}
      {showTokenInput && (
        <div className="space-y-1.5 p-2 rounded bg-neutral-900/60 border border-codefire-orange/30">
          <p className="text-[10px] text-neutral-300">
            {tokenInputConfig?.hint}
          </p>
          <div className="flex gap-1.5">
            <input
              type="password"
              value={tokenValue}
              onChange={(e) => setTokenValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitToken()}
              placeholder="sk-ant-oat01-..."
              className="flex-1 px-2 py-1 text-[11px] bg-neutral-800 border border-neutral-600 rounded text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-codefire-orange font-mono"
              autoFocus
            />
            <button
              type="button"
              onClick={handleSubmitToken}
              disabled={connecting || !tokenValue.trim()}
              className="px-2.5 py-1 text-[10px] font-medium rounded bg-codefire-orange text-white hover:bg-codefire-orange/80 disabled:opacity-40 transition-colors"
            >
              {connecting ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => { setShowTokenInput(false); setTokenValue(''); setSubmitError(null) }}
              className="px-1.5 py-1 text-neutral-500 hover:text-neutral-300 transition-colors"
              title="Cancel"
            >
              <X size={12} />
            </button>
          </div>
          {submitError && (
            <p className="text-[9px] text-red-400">{submitError}</p>
          )}
        </div>
      )}

      {/* Code-copy flow: paste input (OpenAI/Gemini if needed) */}
      {awaitingCode && (
        <div className="space-y-1.5 p-2 rounded bg-neutral-900/60 border border-codefire-orange/30">
          <p className="text-[10px] text-neutral-300">
            A browser window opened. After you authorize, copy the code and paste it here:
          </p>
          <div className="flex gap-1.5">
            <input
              type="text"
              value={pasteCode}
              onChange={(e) => setPasteCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSubmitCode()}
              placeholder="Paste authorization code..."
              className="flex-1 px-2 py-1 text-[11px] bg-neutral-800 border border-neutral-600 rounded text-neutral-200 placeholder:text-neutral-500 focus:outline-none focus:border-codefire-orange"
              autoFocus
            />
            <button
              type="button"
              onClick={handleSubmitCode}
              disabled={connecting || !pasteCode.trim()}
              className="px-2.5 py-1 text-[10px] font-medium rounded bg-codefire-orange text-white hover:bg-codefire-orange/80 disabled:opacity-40 transition-colors"
            >
              {connecting ? 'Verifying...' : 'Submit'}
            </button>
            <button
              type="button"
              onClick={() => { setAwaitingCode(false); setPasteCode(''); setSubmitError(null) }}
              className="px-1.5 py-1 text-neutral-500 hover:text-neutral-300 transition-colors"
              title="Cancel"
            >
              <X size={12} />
            </button>
          </div>
          {submitError && (
            <p className="text-[9px] text-red-400">{submitError}</p>
          )}
        </div>
      )}

      {/* Connecting */}
      {connecting && !awaitingCode && !showTokenInput && (
        <p className="text-[10px] text-codefire-orange">Authenticating...</p>
      )}

      {/* Add account button */}
      {!showTokenInput && (
        <button
          type="button"
          onClick={handleAddAccount}
          disabled={connecting}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-neutral-700
                     text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors disabled:opacity-50"
        >
          <Plus size={10} />
          {hasAccounts
            ? (tokenInputConfig ? 'Add another token' : 'Add another account')
            : (tokenInputConfig ? 'Paste setup token' : 'Connect account')}
        </button>
      )}

      {accounts.length > 1 && (
        <p className="text-[9px] text-neutral-600">
          Requests are distributed across accounts using round-robin to balance rate limits.
        </p>
      )}
    </div>
  )
}

const PROVIDER_OPTIONS: { value: AIProviderType; label: string }[] = [
  { value: 'openrouter', label: 'OpenRouter' },
  { value: 'custom', label: 'Custom Endpoint' },
  { value: 'claude-subscription', label: 'Claude Max' },
  { value: 'openai-subscription', label: 'ChatGPT Plus' },
  { value: 'gemini-subscription', label: 'Gemini' },
  { value: 'kimi-subscription', label: 'Kimi' },
]

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
            <div
              key={i}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-neutral-800 border border-neutral-700"
            >
              <input
                type="text"
                value={rule.pattern}
                onChange={(e) => updateRule(i, { pattern: e.target.value })}
                placeholder="claude-opus*"
                className="w-36 bg-neutral-900 border border-neutral-700 rounded px-2 py-1
                           text-[11px] text-neutral-200 placeholder:text-neutral-600 font-mono
                           focus:outline-none focus:border-codefire-orange/50"
                title="Pattern (model ID prefix)"
              />
              <select
                value={rule.provider}
                onChange={(e) => updateRule(i, { provider: e.target.value as AIProviderType })}
                className="w-36 bg-neutral-900 border border-neutral-700 rounded px-2 py-1
                           text-[11px] text-neutral-200
                           focus:outline-none focus:border-codefire-orange/50"
              >
                {PROVIDER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={rule.label}
                onChange={(e) => updateRule(i, { label: e.target.value })}
                placeholder="Opus via Claude Max"
                className="flex-1 min-w-0 bg-neutral-900 border border-neutral-700 rounded px-2 py-1
                           text-[11px] text-neutral-200 placeholder:text-neutral-600
                           focus:outline-none focus:border-codefire-orange/50"
                title="Description"
              />
              <button
                type="button"
                onClick={() => removeRule(i)}
                className="text-neutral-600 hover:text-red-400 transition-colors shrink-0 p-0.5"
                title="Remove rule"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={addRule}
        className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-neutral-700
                   text-neutral-400 hover:text-neutral-200 hover:border-neutral-600 transition-colors"
      >
        <Plus size={10} />
        Add rule
      </button>
    </div>
  )
}

export default function SettingsTabEngine({ config, onChange }: Props) {
  return (
    <div className="space-y-6">
      <Section title="AI Provider">
        <Select
          label="Provider"
          hint="Choose how the agent connects to AI models."
          value={config.aiProvider || 'openrouter'}
          onChange={(v) => onChange({ aiProvider: v as AppConfig['aiProvider'] })}
          options={[
            { value: 'openrouter', label: 'OpenRouter (API key)' },
            { value: 'custom', label: 'Custom Endpoint (OpenAI-compatible)' },
            { value: 'claude-subscription', label: 'Claude (your subscription)' },
            { value: 'openai-subscription', label: 'OpenAI (your subscription)' },
            { value: 'gemini-subscription', label: 'Gemini (your subscription)' },
            { value: 'kimi-subscription', label: 'Kimi (your subscription)' },
          ]}
        />

        {(config.aiProvider || 'openrouter') === 'openrouter' && (
          <TextInput
            label="OpenRouter API Key"
            hint="Used for embeddings, chat, and image generation. Get one at openrouter.ai"
            placeholder="sk-or-..."
            value={config.openRouterKey}
            onChange={(v) => onChange({ openRouterKey: v })}
            secret
          />
        )}

        {config.aiProvider === 'custom' && (
          <>
            <TextInput
              label="Endpoint URL"
              hint="Base URL of an OpenAI-compatible API (e.g. http://localhost:8080/v1). Works with CLIProxyAPI, Ollama, LM Studio, LiteLLM, etc."
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
          </>
        )}

        {(config.aiProvider === 'claude-subscription' ||
          config.aiProvider === 'openai-subscription' ||
          config.aiProvider === 'gemini-subscription' ||
          config.aiProvider === 'kimi-subscription') && (
          <SubscriptionProviderPanel provider={config.aiProvider} />
        )}

        {/* Fallback config — shown for subscription and custom providers */}
        {config.aiProvider && config.aiProvider !== 'openrouter' && (
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
        )}
      </Section>

      <Section title="Models">
        <Select
          label="Embedding model"
          value={config.embeddingModel}
          onChange={(v) => onChange({ embeddingModel: v })}
          options={[
            { value: 'openai/text-embedding-3-small', label: 'text-embedding-3-small' },
            { value: 'openai/text-embedding-3-large', label: 'text-embedding-3-large' },
          ]}
        />
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

      <Section title="Model Routing">
        <p className="text-[10px] text-neutral-600 mb-1">
          Route specific models to specific providers. Pattern matches model ID prefix.
          First matching rule wins. If no rule matches, the default AI Provider above is used.
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

      <Section title="Index Status">
        <p className="text-[10px] text-neutral-600 mb-2">
          Semantic code index for each project. Rebuild to re-index all files, or clear to remove index data.
        </p>
        <IndexStatusPanel />
      </Section>
    </div>
  )
}
