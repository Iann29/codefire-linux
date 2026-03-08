import { useState, useEffect, useRef, useCallback } from 'react'
import { Send, Loader2, Plus, ChevronDown, Trash2, Copy, ListTodo, StickyNote, Terminal, Flame, Zap, BookOpen, Wrench, Square, Cpu, X, AlertTriangle } from 'lucide-react'
import type { ChatConversation, ChatMessage, Session, RateLimitInfo } from '@shared/models'
import { api } from '@renderer/lib/api'
import PlanRail from './PlanRail'
import AgentRunStatus from './AgentRunStatus'
import { parseSlashCommand, formatContextCommand, getContextWindowSize, estimateTokens } from './chatCommands'

// ─── Types ───────────────────────────────────────────────────────────────────

type ChatMode = 'context' | 'agent'

interface CodeFireChatProps {
  projectId?: string
  projectName?: string
}

interface ToolExecution {
  callId?: string
  name: string
  args: Record<string, unknown>
  result?: string
  status: 'running' | 'done' | 'error'
}

interface PlanStep {
  title: string
  status: 'pending' | 'done' | 'blocked'
}

interface AgentRuntimeOptions {
  maxToolCalls: number
  temperature: number
  planEnforcement: boolean
  contextCompaction: boolean
}

// ─── Chat Model Options ──────────────────────────────────────────────────────

type ModelCapability = 'tools' | 'vision' | 'streaming'

interface ChatModelOption {
  value: string
  label: string
  provider?: string // subscription provider that offers this model natively
  capabilities?: ModelCapability[]
}

const CHAT_MODELS: ChatModelOption[] = [
  // OpenRouter models (available to all)
  { value: 'google/gemini-3.1-pro-preview', label: 'Gemini 3.1 Pro', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'google/gemini-3-flash-preview', label: 'Gemini 3 Flash', capabilities: ['vision', 'streaming'] },
  { value: 'qwen/qwen3.5-plus-02-15', label: 'Qwen 3.5 Plus', capabilities: ['tools', 'streaming'] },
  { value: 'qwen/qwen3-coder-next', label: 'Qwen3 Coder Next', capabilities: ['tools', 'streaming'] },
  { value: 'deepseek/deepseek-v3.2', label: 'DeepSeek V3.2', capabilities: ['tools', 'streaming'] },
  { value: 'minimax/minimax-m2.5', label: 'MiniMax M2.5', capabilities: ['streaming'] },
  { value: 'z-ai/glm-5', label: 'GLM-5', capabilities: ['tools', 'streaming'] },
  { value: 'moonshotai/kimi-k2.5', label: 'Kimi K2.5', capabilities: ['tools', 'streaming'] },
  { value: 'openai/gpt-5.4', label: 'GPT-5.4', capabilities: ['tools', 'vision', 'streaming'] },
  // Subscription-native models
  { value: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'claude-subscription', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'claude-subscription', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', provider: 'claude-subscription', capabilities: ['vision', 'streaming'] },
  { value: 'gpt-4.1', label: 'GPT-4.1', provider: 'openai-subscription', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'o3', label: 'o3', provider: 'openai-subscription', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'o4-mini', label: 'o4 Mini', provider: 'openai-subscription', capabilities: ['streaming'] },
  { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro', provider: 'gemini-subscription', capabilities: ['tools', 'vision', 'streaming'] },
  { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'gemini-subscription', capabilities: ['vision', 'streaming'] },
]

// ─── Model Aliases ────────────────────────────────────────────────────────────

interface ModelAlias {
  model: string
  provider?: string
  description: string
}

const MODEL_ALIASES: Record<string, ModelAlias> = {
  best: { model: 'claude-opus-4-6', provider: 'claude-subscription', description: 'Claude Opus 4.6' },
  fast: { model: 'claude-haiku-4-5-20251001', provider: 'claude-subscription', description: 'Claude Haiku 4.5' },
  cheap: { model: 'google/gemini-3-flash-preview', description: 'Gemini 3 Flash' },
  smart: { model: 'google/gemini-3.1-pro-preview', description: 'Gemini 3.1 Pro' },
  code: { model: 'qwen/qwen3-coder-next', description: 'Qwen3 Coder Next' },
}

/** Resolve a model alias to the real model value, or return the original */
function resolveModelAlias(modelValue: string): string {
  const alias = MODEL_ALIASES[modelValue]
  return alias ? alias.model : modelValue
}

/** Get capability badge chars for a model */
function getCapabilityBadges(capabilities?: ModelCapability[]): { char: string; title: string; key: ModelCapability }[] {
  if (!capabilities || capabilities.length === 0) return []
  const badges: { char: string; title: string; key: ModelCapability }[] = []
  if (capabilities.includes('tools')) badges.push({ char: 'T', title: 'Tools', key: 'tools' })
  if (capabilities.includes('vision')) badges.push({ char: 'V', title: 'Vision', key: 'vision' })
  if (capabilities.includes('streaming')) badges.push({ char: 'S', title: 'Streaming', key: 'streaming' })
  return badges
}

/** Build alias entries as ChatModelOption items, filtered by provider availability */
function getAliasOptions(provider: string): ChatModelOption[] {
  return Object.entries(MODEL_ALIASES)
    .filter(([, alias]) => {
      // If the alias points to a subscription model and the user is not on that subscription, hide it
      if (alias.provider && provider !== alias.provider) return false
      return true
    })
    .map(([name, alias]) => {
      const target = CHAT_MODELS.find((m) => m.value === alias.model)
      return {
        value: `__alias__${name}`,
        label: `${name}`,
        provider: alias.provider,
        capabilities: target?.capabilities,
        _aliasTarget: alias.model,
        _aliasDescription: alias.description,
      } as ChatModelOption & { _aliasTarget: string; _aliasDescription: string }
    })
}

/** Get models relevant to the current provider, grouped */
function getModelsForProvider(provider: string): { group: string; models: (ChatModelOption & { _aliasTarget?: string; _aliasDescription?: string })[] }[] {
  const groups: { group: string; models: (ChatModelOption & { _aliasTarget?: string; _aliasDescription?: string })[] }[] = []

  // Aliases group first
  const aliases = getAliasOptions(provider)
  if (aliases.length > 0) {
    groups.push({ group: 'Quick Aliases', models: aliases })
  }

  if (provider.endsWith('-subscription')) {
    const native = CHAT_MODELS.filter((m) => m.provider === provider)
    const openrouter = CHAT_MODELS.filter((m) => !m.provider)
    if (native.length > 0) {
      const label = provider.replace('-subscription', '').replace(/^./, (c) => c.toUpperCase())
      groups.push({ group: `${label} (subscription)`, models: native })
    }
    groups.push({ group: 'OpenRouter', models: openrouter })
    return groups
  }
  // OpenRouter or custom: show only non-subscription models
  groups.push({ group: '', models: CHAT_MODELS.filter((m) => !m.provider) })
  return groups
}

function getModelShortName(modelValue: string): string {
  const found = CHAT_MODELS.find((m) => m.value === modelValue)
  if (found) return found.label
  // Check if it's a resolved alias
  const resolvedModel = resolveModelAlias(modelValue)
  if (resolvedModel !== modelValue) {
    const resolvedFound = CHAT_MODELS.find((m) => m.value === resolvedModel)
    if (resolvedFound) return resolvedFound.label
  }
  // Fallback: strip provider/ prefix or clean up model id
  const parts = modelValue.split('/')
  return parts.length > 1 ? parts.slice(1).join('/') : modelValue.replace(/-\d{8,}$/, '')
}

function formatChatError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)

  // Authentication error
  if (raw.includes('authentication_error') || raw.includes('invalid x-api-key') || raw.includes('401')) {
    return 'Token inválido ou expirado. Gere um novo com `claude setup-token` e atualize em Settings > Engine.'
  }

  // Rate limit
  if (raw.includes('rate_limit_error') || raw.includes('429')) {
    const retryMatch = raw.match(/retry.after.*?(\d+)/i)
    const retryAfter = retryMatch ? ` Aguarde ${retryMatch[1]} segundos.` : ' Aguarde um momento antes de tentar novamente.'
    return `Rate limit atingido.${retryAfter}`
  }

  // Overloaded
  if (raw.includes('overloaded') || raw.includes('529')) {
    return 'API temporariamente sobrecarregada. Tente novamente em alguns instantes.'
  }

  // Invalid request
  if (raw.includes('invalid_request_error')) {
    const msgMatch = raw.match(/"message"\s*:\s*"([^"]+)"/)
    return msgMatch ? `Erro na requisição: ${msgMatch[1]}` : 'Requisição inválida. Verifique o modelo selecionado.'
  }

  // Network errors
  if (raw.includes('fetch failed') || raw.includes('ENOTFOUND') || raw.includes('ECONNREFUSED') || raw.includes('NetworkError')) {
    return 'Sem conexão com a API. Verifique sua internet.'
  }

  // Not connected
  if (raw.includes('not connected') || raw.includes('setup-token')) {
    return 'Claude subscription não conectado. Execute `claude setup-token` e cole o token em Settings > Engine.'
  }

  // OpenRouter key missing
  if (raw.includes('API key not configured') || raw.includes('openRouterKey')) {
    return 'API key não configurada. Adicione sua chave em Settings > Engine.'
  }

  // Generic: trim IPC wrapping noise
  return raw
    .replace(/^Error: Error invoking remote method '[^']+': /, '')
    .replace(/^ProviderHttpError: /, '')
    .slice(0, 300)
}

// ─── Context Builder (Mode 1 — matches Swift ContextAssembler) ───────────────

async function buildContextWithRAG(
  projectId: string | undefined,
  projectName: string,
  userQuery: string,
  isGlobal: boolean
): Promise<string> {
  if (isGlobal) return buildGlobalContext()

  const MAX_CHARS = 12000
  let context = `You are a helpful assistant with deep context about the "${projectName}" project.\n`
  context += `Answer questions about this project's tasks, sessions, notes, architecture, and codebase.\n\n`
  let budget = MAX_CHARS - context.length

  // RAG: search code chunks matching the query
  if (projectId) {
    try {
      const results = await api.search.query(projectId, userQuery, { limit: 5 })
      if (results.length > 0) {
        let section = 'RELEVANT CODE (matching your question):\n'
        for (const r of results) {
          const lines = r.startLine && r.endLine ? `${r.startLine}-${r.endLine}` : ''
          const location = lines ? `${r.filePath}:${lines}` : (r.filePath || 'unknown')
          const symbol = r.symbolName ? ` (${r.symbolName})` : ''
          section += `--- ${location}${symbol} ---\n${r.content.slice(0, 500)}\n\n`
        }
        if (section.length < budget) {
          context += section
          budget -= section.length
        }
      }
    } catch { /* index may not be ready */ }
  }

  // Active tasks
  if (projectId) {
    try {
      const tasks = await api.tasks.list(projectId)
      const active = tasks.filter(t => t.status !== 'done').slice(0, 20)
      if (active.length > 0) {
        let section = `ACTIVE TASKS (${active.length}):\n`
        for (const t of active) {
          const labels = t.labels ? JSON.parse(t.labels).join(', ') : ''
          const desc = t.description ? ` — ${t.description.slice(0, 120)}` : ''
          section += `- [${t.status}] P${t.priority} "${t.title}"${desc}${labels ? ` (${labels})` : ''}\n`
        }
        section += '\n'
        if (section.length < budget) {
          context += section
          budget -= section.length
        }
      }
    } catch { /* ignore */ }
  }

  // Pinned notes (full content)
  if (projectId) {
    try {
      const notes = await api.notes.list(projectId, true)
      if (notes.length > 0) {
        let section = 'PINNED NOTES:\n'
        for (const n of notes.slice(0, 5)) {
          section += `## ${n.title}\n${n.content.slice(0, 500)}\n\n`
        }
        if (section.length < budget) {
          context += section
          budget -= section.length
        }
      }
    } catch { /* ignore */ }
  }

  // Recent sessions
  if (projectId) {
    try {
      const sessions = await api.sessions.list(projectId)
      const recent = sessions.slice(0, 5)
      if (recent.length > 0) {
        let section = 'RECENT SESSIONS:\n'
        for (const s of recent) {
          const date = s.startedAt ? new Date(s.startedAt).toLocaleDateString() : '?'
          const summary = s.summary ? s.summary.slice(0, 150) : 'No summary'
          section += `- ${date}: "${summary}" (${s.model || 'unknown'})\n`
        }
        section += '\n'
        if (section.length < budget) {
          context += section
          budget -= section.length
        }
      }
    } catch { /* ignore */ }
  }

  // Recent notes (titles only)
  if (projectId) {
    try {
      const notes = await api.notes.list(projectId)
      const recent = notes.slice(0, 10)
      if (recent.length > 0) {
        let section = 'RECENT NOTES:\n'
        for (const n of recent) {
          section += `- "${n.title}"\n`
        }
        if (section.length < budget) {
          context += section
        }
      }
    } catch { /* ignore */ }
  }

  context += '\nRespond helpfully and concisely. Reference specific tasks, sessions, files, or notes when relevant. Use markdown formatting.'
  return context
}

async function buildGlobalContext(): Promise<string> {
  let context = 'You are a helpful assistant integrated into CodeFire, a project management companion for AI coding agents.\n'
  context += 'You have context about all projects, global tasks, and notes.\n\n'
  let budget = 8000 - context.length

  try {
    const projects = await api.projects.list()
    if (projects.length > 0) {
      let section = `PROJECTS (${projects.length}):\n`
      for (const p of projects.slice(0, 20)) {
        const lastOpened = p.lastOpened ? new Date(p.lastOpened).toLocaleDateString() : 'never'
        section += `- "${p.name}" (last opened: ${lastOpened})\n`
      }
      section += '\n'
      if (section.length < budget) {
        context += section
        budget -= section.length
      }
    }
  } catch { /* ignore */ }

  try {
    const tasks = await api.tasks.listGlobal()
    const active = tasks.filter(t => t.status !== 'done').slice(0, 15)
    if (active.length > 0) {
      let section = 'GLOBAL TASKS:\n'
      for (const t of active) {
        section += `- [${t.status}] P${t.priority} "${t.title}"\n`
      }
      section += '\n'
      if (section.length < budget) {
        context += section
      }
    }
  } catch { /* ignore */ }

  context += '\nRespond helpfully and concisely. Use markdown formatting.'
  return context
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function CodeFireChat({ projectId, projectName = 'All Projects' }: CodeFireChatProps) {
  const isGlobal = !projectId
  const [conversations, setConversations] = useState<ChatConversation[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [streamedContent, setStreamedContent] = useState('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [showDropdown, setShowDropdown] = useState(false)
  const [chatMode, setChatMode] = useState<ChatMode>('context')
  const [chatModel, setChatModel] = useState('google/gemini-3.1-pro-preview')
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [aiProvider, setAiProvider] = useState<string>('openrouter')
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [planSteps, setPlanSteps] = useState<PlanStep[]>([])
  const [awaitingVerification, setAwaitingVerification] = useState(false)
  const [lastBrowserAction, setLastBrowserAction] = useState<string | null>(null)
  const [compactionInfo, setCompactionInfo] = useState<{ trimmedCount: number; before: number; after: number } | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ runId: string; action: string; details: Record<string, unknown> } | null>(null)
  const [showContinue, setShowContinue] = useState(false)
  const [messageUsage, setMessageUsage] = useState<Record<number, { prompt_tokens?: number; completion_tokens?: number }>>({})
  const [messageTools, setMessageTools] = useState<Record<number, ToolExecution[]>>({})
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null)
  const [rateLimitDismissed, setRateLimitDismissed] = useState(false)
  const [rateLimitCountdown, setRateLimitCountdown] = useState('')
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const modelDropdownRef = useRef<HTMLDivElement>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const pendingRunsRef = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void }>())
  // Load config for chat defaults
  useEffect(() => {
    window.api.invoke('settings:get').then((config: any) => {
      if (config?.chatMode) setChatMode(config.chatMode)
      if (config?.chatModel) setChatModel(config.chatModel)
      if (config?.aiProvider) setAiProvider(config.aiProvider)
    })
  }, [])

  // Rate limit event listeners
  useEffect(() => {
    const cleanupRateLimited = window.api.on('provider:rateLimited', (info: any) => {
      setRateLimitInfo(info as RateLimitInfo)
      setRateLimitDismissed(false)
    })

    const cleanupRateLimitCleared = window.api.on('provider:rateLimitCleared', (_payload: any) => {
      setRateLimitInfo(null)
      setRateLimitDismissed(false)
      setRateLimitCountdown('')
    })

    return () => {
      cleanupRateLimited()
      cleanupRateLimitCleared()
    }
  }, [])

  // Rate limit countdown timer
  useEffect(() => {
    if (!rateLimitInfo || rateLimitDismissed) return

    function updateCountdown() {
      if (!rateLimitInfo) return
      const expiresAt = rateLimitInfo.resetAt
        ?? (rateLimitInfo.retryAfterMs ? rateLimitInfo.detectedAt + rateLimitInfo.retryAfterMs : null)

      if (!expiresAt) {
        setRateLimitCountdown('')
        return
      }

      const remaining = Math.max(0, expiresAt - Date.now())
      if (remaining <= 0) {
        setRateLimitInfo(null)
        setRateLimitCountdown('')
        return
      }

      const totalSeconds = Math.ceil(remaining / 1000)
      const minutes = Math.floor(totalSeconds / 60)
      const seconds = totalSeconds % 60

      if (minutes > 0) {
        setRateLimitCountdown(`~${minutes}m ${seconds.toString().padStart(2, '0')}s`)
      } else {
        setRateLimitCountdown(`${seconds}s`)
      }
    }

    updateCountdown()
    const intervalId = setInterval(updateCountdown, 1000)
    return () => clearInterval(intervalId)
  }, [rateLimitInfo, rateLimitDismissed])

  // Load conversations and sessions
  const loadConversations = useCallback(async () => {
    const list = await api.chat.listConversations(projectId || '__global__')
    setConversations(list)
    return list
  }, [projectId])

  const loadSessions = useCallback(async () => {
    if (!projectId) { setSessions([]); return }
    const list = await api.sessions.list(projectId)
    setSessions(list)
  }, [projectId])

  useEffect(() => {
    loadConversations().then((list) => {
      if (list.length > 0) setActiveConversationId(list[0].id)
    })
    loadSessions()
  }, [loadConversations, loadSessions])

  useEffect(() => {
    if (activeConversationId) {
      api.chat.listMessages(activeConversationId).then(setMessages)
    } else {
      setMessages([])
    }
  }, [activeConversationId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamedContent, toolExecutions])

  useEffect(() => {
    inputRef.current?.focus()
  }, [activeConversationId])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setShowModelDropdown(false)
      }
    }
    if (showDropdown || showModelDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showDropdown, showModelDropdown])

  useEffect(() => {
    const cleanupStream = window.api.on('agent:stream', (payload: any) => {
      const runId = String(payload?.runId ?? '')
      if (!runId || runId !== activeRunIdRef.current) return
      const channel = String(payload?.channel ?? 'text')
      if (channel !== 'text') return
      const delta = String(payload?.delta ?? '')
      if (!delta) return
      setStreaming(true)
      setStreamedContent((prev) => prev + delta)
    })

    const cleanupToolStart = window.api.on('agent:toolStart', (payload: any) => {
      const runId = String(payload?.runId ?? '')
      if (!runId || runId !== activeRunIdRef.current) return

      const callId = String(payload?.callId ?? '')
      const name = String(payload?.name ?? 'tool')
      const args = typeof payload?.args === 'object' && payload.args !== null ? payload.args as Record<string, unknown> : {}
      setToolExecutions((prev) => [...prev, { callId, name, args, status: 'running' }])
    })

    const cleanupToolResult = window.api.on('agent:toolResult', (payload: any) => {
      const runId = String(payload?.runId ?? '')
      if (!runId || runId !== activeRunIdRef.current) return

      const callId = String(payload?.callId ?? '')
      const status = payload?.status === 'error' ? 'error' : 'done'
      const result = String(payload?.result ?? '').slice(0, 200)
      const durationMs = typeof payload?.durationMs === 'number' ? payload.durationMs : null

      setToolExecutions((prev) => prev.map((execution) => {
        if (callId && execution.callId === callId) {
          const nextResult = durationMs !== null ? `${result} (${durationMs}ms)` : result
          return { ...execution, status, result: nextResult }
        }
        return execution
      }))
    })

    const cleanupPlanUpdate = window.api.on('agent:planUpdate', (payload: any) => {
      const runId = String(payload?.runId ?? '')
      if (!runId || runId !== activeRunIdRef.current) return

      const steps = Array.isArray(payload?.plan)
        ? payload.plan
          .filter((step: any) => step && typeof step.title === 'string')
          .map((step: any) => ({
            title: String(step.title),
            status: step.status === 'done' || step.status === 'blocked' ? step.status : 'pending',
          }))
        : []

      setPlanSteps(steps)
      setAwaitingVerification(payload?.awaitingVerification === true)
      setLastBrowserAction(typeof payload?.lastBrowserAction === 'string' ? payload.lastBrowserAction : null)
    })

    const cleanupCompacted = window.api.on('agent:compacted', (payload: any) => {
      const runId = String(payload?.runId ?? '')
      if (!runId || runId !== activeRunIdRef.current) return

      const trimmedCount = typeof payload?.trimmedCount === 'number' ? payload.trimmedCount : 0
      const before = typeof payload?.contextUsage?.before === 'number' ? payload.contextUsage.before : 0
      const after = typeof payload?.contextUsage?.after === 'number' ? payload.contextUsage.after : 0
      setCompactionInfo({ trimmedCount, before, after })
    })

    const cleanupConfirmAction = window.api.on('agent:confirmAction', (payload: any) => {
      const runId = String(payload?.runId ?? '')
      if (!runId || runId !== activeRunIdRef.current) return

      const action = String(payload?.action ?? '')
      const details = typeof payload?.details === 'object' && payload.details !== null
        ? payload.details as Record<string, unknown>
        : {}
      setConfirmAction({ runId, action, details })
    })

    const cleanupDone = window.api.on('agent:done', (payload: any) => {
      const runId = String(payload?.runId ?? '')
      if (!runId || runId !== activeRunIdRef.current) return

      if (payload?.message) {
        const msg = payload.message as ChatMessage
        setMessages((prev) => [...prev, msg])
        if (payload?.usage) {
          setMessageUsage((prev) => ({ ...prev, [msg.id]: payload.usage }))
        }
        // Persist tool executions for this message
        setToolExecutions((currentTools) => {
          if (currentTools.length > 0) {
            setMessageTools((prev) => ({ ...prev, [msg.id]: currentTools }))
          }
          return []
        })
      } else {
        setToolExecutions([])
      }

      setStreaming(false)
      setStreamedContent('')
      setAwaitingVerification(false)
      setCompactionInfo(null)
      setConfirmAction(null)

      if (payload?.hitLimit) {
        setShowContinue(true)
      }

      activeRunIdRef.current = null
      setActiveRunId(null)
      const pending = pendingRunsRef.current.get(runId)
      pendingRunsRef.current.delete(runId)
      pending?.resolve()
    })

    const cleanupError = window.api.on('agent:error', (payload: any) => {
      const runId = String(payload?.runId ?? '')
      if (!runId || runId !== activeRunIdRef.current) return

      const pending = pendingRunsRef.current.get(runId)
      pendingRunsRef.current.delete(runId)
      activeRunIdRef.current = null
      setActiveRunId(null)

      setStreaming(false)
      setStreamedContent('')
      setToolExecutions([])
      setAwaitingVerification(false)
      setCompactionInfo(null)
      setConfirmAction(null)

      const message = String(payload?.error ?? 'Unknown agent error')
      pending?.reject(new Error(message))
    })

    return () => {
      cleanupStream()
      cleanupToolStart()
      cleanupToolResult()
      cleanupPlanUpdate()
      cleanupCompacted()
      cleanupConfirmAction()
      cleanupDone()
      cleanupError()
      pendingRunsRef.current.forEach(({ reject }) => reject(new Error('Agent run interrupted')))
      pendingRunsRef.current.clear()
      activeRunIdRef.current = null
      setActiveRunId(null)
      setAwaitingVerification(false)
      setConfirmAction(null)
    }
  }, [])

  async function handleNewConversation() {
    const conv = await api.chat.createConversation({
      projectId: projectId || '__global__',
      title: 'New Chat',
    })
    setConversations((prev) => [conv, ...prev])
    setActiveConversationId(conv.id)
    setMessages([])
    setShowDropdown(false)
  }

  async function handleDeleteConversation(id: number, e: React.MouseEvent) {
    e.stopPropagation()
    await api.chat.deleteConversation(id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    if (activeConversationId === id) {
      setActiveConversationId(null)
      setMessages([])
    }
  }

  function toggleMode() {
    const next = chatMode === 'context' ? 'agent' : 'context'
    setChatMode(next)
    api.settings.set({ chatMode: next })
  }

  // ─── Send (dispatches to mode) ─────────────────────────────────────────────

  async function handleSend(contentOverride?: string) {
    const rawContent = contentOverride || input.trim()
    if (!rawContent || sending) return

    // Check for slash commands before sending
    const cmdResult = parseSlashCommand(rawContent)
    if (cmdResult.kind === 'error') {
      setMessages(prev => [...prev, {
        id: -Date.now(),
        conversationId: activeConversationId ?? 0,
        role: 'assistant' as const,
        content: cmdResult.message,
        createdAt: new Date().toISOString(),
      }])
      setInput('')
      return
    }
    if (cmdResult.kind === 'local' && cmdResult.command === 'context') {
      const contextMessages = messages.filter(m => m.role !== 'system')
      const allText = contextMessages.map(m => m.content).join('\n')
      const tokens = estimateTokens(allText)
      const ctxWindow = getContextWindowSize(chatModel)
      const percent = ctxWindow ? (tokens / ctxWindow) * 100 : null

      const info = formatContextCommand({
        model: chatModel,
        provider: aiProvider,
        messageCount: contextMessages.length,
        estimatedTokens: tokens,
        contextWindow: ctxWindow,
        percentUsed: percent,
        hasCompaction: !!compactionInfo,
        compactionCount: compactionInfo?.trimmedCount,
      })

      setMessages(prev => [...prev, {
        id: -Date.now(),
        conversationId: activeConversationId ?? 0,
        role: 'assistant' as const,
        content: info,
        createdAt: new Date().toISOString(),
      }])
      setInput('')
      return
    }

    const content = rawContent
    if (!contentOverride) setInput('')
    setSending(true)
    setRunStartedAt(Date.now())
    setErrorMessage(null)
    setToolExecutions([])
    setPlanSteps([])
    setAwaitingVerification(false)
    setLastBrowserAction(null)
    setCompactionInfo(null)
    setShowContinue(false)

    // Ensure conversation
    let convId = activeConversationId
    if (!convId) {
      try {
        const title = content.slice(0, 60)
        const conv = await api.chat.createConversation({ projectId: projectId || '__global__', title })
        setConversations((prev) => [conv, ...prev])
        setActiveConversationId(conv.id)
        convId = conv.id
      } catch (err) {
        setErrorMessage(`Falha ao criar conversa: ${formatChatError(err)}`)
        setSending(false)
        setInput(content)
        return
      }
    }

    // Save user message
    let userMsg: ChatMessage
    try {
      userMsg = await api.chat.sendMessage({ conversationId: convId, role: 'user', content })
      setMessages((prev) => [...prev, userMsg])
    } catch (err) {
      setErrorMessage(`Falha ao salvar mensagem: ${formatChatError(err)}`)
      setSending(false)
      setInput(content)
      return
    }

    // Get config — use local dropdown state for model/provider (most up-to-date),
    // read persisted settings only for API key and agent runtime options.
    let apiKey: string | undefined
    const model = resolveModelAlias(chatModel)
    const provider = aiProvider
    let runtimeOptions: AgentRuntimeOptions = {
      maxToolCalls: 30,
      temperature: 0.7,
      planEnforcement: true,
      contextCompaction: false,
    }
    try {
      const config = (await window.api.invoke('settings:get')) as {
        openRouterKey?: string
        agentMaxToolCalls?: number
        agentTemperature?: number
        agentPlanEnforcement?: boolean
        agentContextCompaction?: boolean
      } | undefined
      apiKey = config?.openRouterKey
      runtimeOptions = {
        maxToolCalls: typeof config?.agentMaxToolCalls === 'number'
          ? Math.max(1, Math.min(100, Math.round(config.agentMaxToolCalls)))
          : 30,
        temperature: typeof config?.agentTemperature === 'number'
          ? Math.max(0, Math.min(1, config.agentTemperature))
          : 0.7,
        planEnforcement: typeof config?.agentPlanEnforcement === 'boolean'
          ? config.agentPlanEnforcement
          : true,
        contextCompaction: typeof config?.agentContextCompaction === 'boolean'
          ? config.agentContextCompaction
          : false,
      }
    } catch {
      // Defaults already set above
    }

    const isSubscription = provider.endsWith('-subscription')

    // Only require OpenRouter key when using OpenRouter
    if (!isSubscription && !apiKey) {
      const noKeyMessage = `**OpenRouter API key required**\n\nTo use the CodeFire agent, add your API key in **Settings** > **Engine** tab.`
      try {
        const errorMsg = await api.chat.sendMessage({ conversationId: convId, role: 'assistant', content: noKeyMessage })
        setMessages((prev) => [...prev, errorMsg])
      } catch {
        setMessages((prev) => [...prev, { id: -1, conversationId: convId, role: 'assistant', content: noKeyMessage, createdAt: new Date().toISOString() }])
      }
      setSending(false)
      return
    }

    try {
      if (chatMode === 'agent') {
        await handleAgentModeMain(convId, content, userMsg, apiKey ?? '', model, runtimeOptions)
      } else if (isSubscription) {
        await handleContextModeProvider(convId, content, userMsg, model)
      } else {
        await handleContextMode(convId, content, userMsg, apiKey!, model)
      }
    } catch (err) {
      console.error('Chat error:', err)
      setStreaming(false)
      setStreamedContent('')
      const friendlyError = formatChatError(err)
      setMessages((prev) => [...prev, {
        id: -Date.now(), conversationId: convId, role: 'assistant',
        content: `**Error:** ${friendlyError}`, createdAt: new Date().toISOString(),
      }])
    } finally {
      setSending(false)
      setRunStartedAt(null)
      setToolExecutions([])
    }
  }

  // ─── Context Mode (Swift parity — RAG + context stuffing) ──────────────────

  async function handleContextMode(
    convId: number,
    _userContent: string,
    userMsg: ChatMessage,
    apiKey: string,
    model: string
  ) {
    const context = await buildContextWithRAG(projectId, projectName, _userContent, isGlobal)
    const allMessages = [...messages, userMsg]
    let historyChars = 0
    const history: { role: string; content: string }[] = []
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const m = allMessages[i]
      if (historyChars + m.content.length > 25000) break
      history.unshift({ role: m.role, content: m.content })
      historyChars += m.content.length
    }

    setStreaming(true)
    setStreamedContent('')

    const fullContent = await streamChat(apiKey, model, [
      { role: 'system', content: context },
      ...history.slice(-20),
    ])

    setStreaming(false)
    setStreamedContent('')

    if (fullContent) {
      const assistantMsg = await api.chat.sendMessage({ conversationId: convId, role: 'assistant', content: fullContent })
      setMessages((prev) => [...prev, assistantMsg])
      updateConversationTitle(convId, _userContent)
    }
  }

  // ─── Context Mode via ProviderRouter (subscription providers) ──────────────

  async function handleContextModeProvider(
    convId: number,
    _userContent: string,
    userMsg: ChatMessage,
    model: string,
  ) {
    const context = await buildContextWithRAG(projectId, projectName, _userContent, isGlobal)
    const allMessages = [...messages, userMsg]
    let historyChars = 0
    const history: { role: string; content: string }[] = []
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const m = allMessages[i]
      if (historyChars + m.content.length > 25000) break
      history.unshift({ role: m.role, content: m.content })
      historyChars += m.content.length
    }

    setStreaming(true)
    setStreamedContent('')

    // Listen for streaming chunks from main process
    const cleanupChunk = window.api.on('chat:streamChunk', (chunk: unknown) => {
      const text = String(chunk ?? '')
      if (text) setStreamedContent((prev) => prev + text)
    })

    try {
      const result = await api.chat.streamProviderCompletion({
        model,
        messages: [
          { role: 'system', content: context },
          ...history.slice(-20),
        ],
      })

      cleanupChunk()
      setStreaming(false)
      setStreamedContent('')

      if (result.content) {
        const assistantMsg = await api.chat.sendMessage({ conversationId: convId, role: 'assistant', content: result.content })
        setMessages((prev) => [...prev, assistantMsg])
        if (result.usage) {
          setMessageUsage((prev) => ({ ...prev, [assistantMsg.id]: result.usage! }))
        }
        updateConversationTitle(convId, _userContent)
      }
    } catch (err) {
      cleanupChunk()
      throw err
    }
  }

  // ─── Agent Mode (main-process runtime with fallback) ───────────────────────

  async function handleAgentModeMain(
    convId: number,
    userContent: string,
    _userMsg: ChatMessage,
    apiKey: string,
    model: string,
    runtimeOptions: AgentRuntimeOptions
  ) {
    setStreaming(true)
    setStreamedContent('')

    let started: { runId: string }
    try {
      started = await api.agent.start({
        conversationId: convId,
        userMessage: userContent,
        projectId: projectId || null,
        projectName,
        model,
        apiKey,
        maxIterations: runtimeOptions.maxToolCalls,
        maxToolCalls: runtimeOptions.maxToolCalls,
        temperature: runtimeOptions.temperature,
        planEnforcement: runtimeOptions.planEnforcement,
        contextCompaction: runtimeOptions.contextCompaction,
      })
    } catch (error) {
      activeRunIdRef.current = null
      setActiveRunId(null)
      setStreaming(false)
      setStreamedContent('')
      throw new Error('Agent service not ready. Please try again in a moment.')
    }

    activeRunIdRef.current = started.runId
    setActiveRunId(started.runId)

    await new Promise<void>((resolve, reject) => {
      pendingRunsRef.current.set(started.runId, { resolve, reject })
    })

    updateConversationTitle(convId, userContent)
  }

  // ─── Streaming helper ──────────────────────────────────────────────────────

  async function streamChat(
    apiKey: string,
    model: string,
    messages: Array<{ role: string; content: string }>
  ): Promise<string> {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'CodeFire',
      },
      body: JSON.stringify({ model, messages, stream: true, max_tokens: 4096 }),
    })

    if (!resp.ok || !resp.body) {
      throw new Error(`API returned ${resp.status}`)
    }

    const reader = resp.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        const data = line.slice(6)
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          const delta = parsed.choices?.[0]?.delta?.content
          if (delta) {
            fullContent += delta
            setStreamedContent(fullContent)
          }
        } catch { /* ignore */ }
      }
    }

    return fullContent
  }

  function updateConversationTitle(convId: number, content: string) {
    const conv = conversations.find(c => c.id === convId)
    if (conv && conv.title === 'New Chat') {
      const newTitle = content.slice(0, 60)
      setConversations((prev) => prev.map(c => c.id === convId ? { ...c, title: newTitle } : c))
    }
  }

  async function handleCopyMessage(content: string) {
    await navigator.clipboard.writeText(content)
  }

  async function handleCreateTask(content: string) {
    try {
      await api.tasks.create({
        projectId: projectId || '__global__',
        title: `Chat: ${content.slice(0, 60)}`,
        description: content,
        source: 'claude',
        isGlobal: isGlobal ? true : undefined,
      })
    } catch (err) { console.error('Failed to create task from chat:', err) }
  }

  async function handleCreateNote(content: string) {
    try {
      await api.notes.create({
        projectId: projectId || '__global__',
        title: `Chat note: ${content.slice(0, 40)}`,
        content,
        isGlobal: isGlobal ? true : undefined,
      })
    } catch (err) { console.error('Failed to create note from chat:', err) }
  }

  function handleSendToTerminal(content: string) {
    navigator.clipboard.writeText(content)
  }

  async function handleCancelRun() {
    const runId = activeRunIdRef.current
    if (!runId) return
    await api.agent.cancel(runId).catch(() => {})
  }

  async function handleContinue() {
    if (!activeConversationId || sending) return
    setShowContinue(false)
    setSending(true)
    setRunStartedAt(Date.now())
    setStreaming(true)
    setStreamedContent('')
    setErrorMessage(null)
    setToolExecutions([])
    setPlanSteps([])
    setAwaitingVerification(false)
    setLastBrowserAction(null)
    setCompactionInfo(null)

    try {
      const started = await api.agent.continue(activeConversationId, projectId || null)
      activeRunIdRef.current = started.runId
      setActiveRunId(started.runId)

      await new Promise<void>((resolve, reject) => {
        pendingRunsRef.current.set(started.runId, { resolve, reject })
      })
    } catch (err) {
      activeRunIdRef.current = null
      setActiveRunId(null)
      setStreaming(false)
      setStreamedContent('')
      const friendlyError = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [...prev, {
        id: -Date.now(), conversationId: activeConversationId, role: 'assistant',
        content: `**Error continuing:** ${friendlyError}`, createdAt: new Date().toISOString(),
      }])
    } finally {
      setSending(false)
      setRunStartedAt(null)
    }
  }

  const activeConversation = conversations.find(c => c.id === activeConversationId)
  const dropdownLabel = activeConversation?.title || 'Select thread...'

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 bg-neutral-950 shrink-0">
        <Flame size={14} className="text-codefire-orange shrink-0" />
        <span className="text-[11px] font-semibold text-neutral-300 shrink-0">CodeFire</span>

        {/* Mode toggle */}
        <button
          onClick={toggleMode}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-colors shrink-0 ${
            chatMode === 'agent'
              ? 'bg-codefire-orange/20 text-codefire-orange border border-codefire-orange/30'
              : 'bg-neutral-800 text-neutral-400 border border-neutral-700 hover:text-neutral-300'
          }`}
          title={chatMode === 'context' ? 'Context Mode — low cost, RAG-enhanced' : 'Agent Mode — full tool calling'}
        >
          {chatMode === 'agent' ? <Zap size={10} /> : <BookOpen size={10} />}
          {chatMode === 'agent' ? 'Agent' : 'Context'}
        </button>

        {/* Model selector */}
        <div className="relative shrink-0" ref={modelDropdownRef}>
          <button
            onClick={() => setShowModelDropdown((v) => !v)}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-800 text-neutral-400 border border-neutral-700 hover:text-neutral-300 transition-colors"
            title={`Model: ${chatModel}`}
          >
            <Cpu size={10} />
            <span className="max-w-[80px] truncate">{getModelShortName(chatModel)}</span>
            {aiProvider.endsWith('-subscription') && (
              <span className="text-[8px] text-green-500 font-bold" title="Using your subscription">SUB</span>
            )}
            <ChevronDown size={8} className="text-neutral-500" />
          </button>

          {showModelDropdown && (
            <div className="absolute top-full left-0 mt-1 w-64 max-h-80 overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50 py-1">
              {getModelsForProvider(aiProvider).map(({ group, models }) => (
                <div key={group || 'default'}>
                  {group && (
                    <div className="px-3 py-1 text-[9px] font-semibold text-neutral-600 uppercase tracking-wider border-t border-neutral-800 first:border-t-0 mt-1 first:mt-0">
                      {group}
                    </div>
                  )}
                  {models.map((m) => {
                    const isAlias = m.value.startsWith('__alias__')
                    const aliasName = isAlias ? m.value.replace('__alias__', '') : null
                    const aliasTarget = isAlias ? (m as ChatModelOption & { _aliasTarget?: string })._aliasTarget : null
                    const aliasDescription = isAlias ? (m as ChatModelOption & { _aliasDescription?: string })._aliasDescription : null
                    const isActive = isAlias ? chatModel === aliasTarget : m.value === chatModel
                    const badges = getCapabilityBadges(m.capabilities)

                    return (
                      <button
                        key={m.value}
                        onClick={() => {
                          const modelToSet = isAlias && aliasTarget ? aliasTarget : m.value
                          setChatModel(modelToSet)
                          api.settings.set({ chatModel: modelToSet })
                          setShowModelDropdown(false)
                        }}
                        className={`flex items-center gap-2 w-full px-3 py-1.5 text-[11px] transition-colors ${
                          isActive
                            ? 'bg-neutral-800 text-codefire-orange'
                            : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300'
                        }`}
                      >
                        {isAlias ? (
                          <span className="truncate flex-1 text-left">
                            <span className="font-semibold">{aliasName}</span>
                            <span className="text-neutral-500"> {'\u2192'} {aliasDescription}</span>
                          </span>
                        ) : (
                          <span className="truncate">{m.label}</span>
                        )}
                        {badges.length > 0 && (
                          <span className="flex items-center gap-0.5 shrink-0">
                            {badges.map((b) => (
                              <span
                                key={b.key}
                                title={b.title}
                                className="text-[8px] text-neutral-600 font-mono leading-none px-0.5 rounded bg-neutral-800"
                              >
                                {b.char}
                              </span>
                            ))}
                          </span>
                        )}
                        {isActive && (
                          <span className="ml-auto text-[9px] text-codefire-orange/60 shrink-0">active</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Conversation dropdown */}
        <div className="relative flex-1 min-w-0" ref={dropdownRef}>
          <button
            onClick={() => setShowDropdown(v => !v)}
            className="flex items-center gap-1.5 w-full px-2 py-1 rounded bg-neutral-800/60 hover:bg-neutral-800 transition-colors text-left min-w-0"
          >
            <span className="text-[11px] text-neutral-300 truncate flex-1">{dropdownLabel}</span>
            <ChevronDown size={12} className="text-neutral-500 shrink-0" />
          </button>

          {showDropdown && (
            <div className="absolute top-full left-0 mt-1 w-72 max-h-80 overflow-y-auto bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl z-50">
              <button
                onClick={handleNewConversation}
                className="flex items-center gap-2 w-full px-3 py-2 text-[11px] text-codefire-orange hover:bg-neutral-800 transition-colors border-b border-neutral-800"
              >
                <Plus size={12} />
                New Chat
              </button>

              {conversations.length > 0 && (
                <div className="py-1">
                  <div className="px-3 py-1 text-[9px] font-semibold text-neutral-600 uppercase tracking-wider">
                    Conversations
                  </div>
                  {conversations.map((conv) => (
                    <button
                      key={conv.id}
                      onClick={() => { setActiveConversationId(conv.id); setShowDropdown(false) }}
                      className={`flex items-center gap-2 w-full px-3 py-1.5 text-[11px] transition-colors group ${
                        conv.id === activeConversationId
                          ? 'bg-neutral-800 text-neutral-200'
                          : 'text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300'
                      }`}
                    >
                      <span className="truncate flex-1 text-left">{conv.title}</span>
                      <span className="text-[9px] text-neutral-600 shrink-0">
                        {new Date(conv.updatedAt).toLocaleDateString()}
                      </span>
                      <button
                        onClick={(e) => handleDeleteConversation(conv.id, e)}
                        className="opacity-0 group-hover:opacity-100 p-0.5 text-neutral-600 hover:text-red-400 transition-all shrink-0"
                      >
                        <Trash2 size={10} />
                      </button>
                    </button>
                  ))}
                </div>
              )}

              {sessions.length > 0 && (
                <div className="py-1 border-t border-neutral-800">
                  <div className="px-3 py-1 text-[9px] font-semibold text-neutral-600 uppercase tracking-wider">
                    Claude Sessions
                  </div>
                  {sessions.slice(0, 20).map((session) => (
                    <button
                      key={session.id}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-[11px] text-neutral-400 hover:bg-neutral-800/50 hover:text-neutral-300 transition-colors"
                    >
                      <Terminal size={10} className="shrink-0 text-neutral-600" />
                      <span className="truncate flex-1 text-left">
                        {session.summary || session.slug || session.id.slice(0, 8)}
                      </span>
                      <span className="text-[9px] text-neutral-600 shrink-0">
                        {session.startedAt ? new Date(session.startedAt).toLocaleDateString() : ''}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <button
          onClick={handleNewConversation}
          className="p-1 rounded text-neutral-500 hover:text-codefire-orange hover:bg-neutral-800 transition-colors shrink-0"
          title="New conversation"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {!activeConversationId && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Flame size={28} className="text-neutral-700 mb-3" />
            <p className="text-xs text-neutral-500 mb-1">CodeFire Agent</p>
            <p className="text-[10px] text-neutral-600 mb-4 max-w-48">
              Ask anything about {projectName}. I have context about your tasks, sessions, notes, and code.
            </p>
            <div className="flex items-center gap-1.5 text-[9px] text-neutral-600">
              {chatMode === 'agent' ? (
                <><Zap size={9} className="text-codefire-orange" /> Agent mode — can use tools</>
              ) : (
                <><BookOpen size={9} /> Context mode — low cost</>
              )}
            </div>
          </div>
        ) : messages.length === 0 && !streaming ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Flame size={20} className="text-neutral-700 mb-2" />
            <p className="text-[10px] text-neutral-600">Ask anything about {projectName}</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatBubble
                key={msg.id}
                role={msg.role}
                content={msg.content}
                usage={messageUsage[msg.id]}
                tools={messageTools[msg.id]}
                onCopy={handleCopyMessage}
                onCreateTask={handleCreateTask}
                onCreateNote={handleCreateNote}
                onSendToTerminal={handleSendToTerminal}
              />
            ))}
            {streaming && streamedContent && (
              <ChatBubble
                role="assistant"
                content={streamedContent}
                onCopy={handleCopyMessage}
                onCreateTask={handleCreateTask}
                onCreateNote={handleCreateNote}
                onSendToTerminal={handleSendToTerminal}
              />
            )}
            {toolExecutions.length > 0 && (
              <div className="space-y-1">
                {toolExecutions.map((te, i) => (
                  <div key={i} className="flex items-center gap-2 px-2 py-1 rounded bg-neutral-800/50 border border-neutral-700/50">
                    {te.status === 'running' ? (
                      <Loader2 size={10} className="animate-spin text-codefire-orange shrink-0" />
                    ) : (
                      <Wrench size={10} className="text-neutral-500 shrink-0" />
                    )}
                    <span className="text-[10px] text-neutral-400 font-mono truncate">
                      {te.name}({Object.keys(te.args).length > 0 ? Object.entries(te.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ').slice(0, 60) : ''})
                    </span>
                    {te.status === 'done' && (
                      <span className="text-[9px] text-green-600 shrink-0">done</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {confirmAction && (
              <div className="flex items-center gap-2 px-3 py-2 rounded bg-yellow-900/20 border border-yellow-800/40">
                <span className="text-[10px] text-yellow-300 flex-1">
                  Confirm: {confirmAction.action}?
                </span>
                <button
                  onClick={() => {
                    window.api.send('agent:confirmResponse', { runId: confirmAction.runId, confirmed: true })
                    setConfirmAction(null)
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-green-600/20 text-green-400 hover:bg-green-600/30"
                >
                  Allow
                </button>
                <button
                  onClick={() => {
                    window.api.send('agent:confirmResponse', { runId: confirmAction.runId, confirmed: false })
                    setConfirmAction(null)
                  }}
                  className="text-[10px] px-2 py-0.5 rounded bg-red-600/20 text-red-400 hover:bg-red-600/30"
                >
                  Deny
                </button>
              </div>
            )}
            {chatMode === 'agent' && planSteps.length > 0 && (
              <PlanRail
                steps={planSteps}
                awaitingVerification={awaitingVerification}
                lastBrowserAction={lastBrowserAction}
              />
            )}
            {compactionInfo && (
              <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-900/20 border border-blue-800/30">
                <span className="text-[10px] text-blue-400">
                  Context compacted: {compactionInfo.trimmedCount} messages summarized ({Math.round(compactionInfo.before / 1000)}k → {Math.round(compactionInfo.after / 1000)}k tokens)
                </span>
              </div>
            )}
            {showContinue && !sending && chatMode === 'agent' && (
              <div className="flex items-center gap-2 px-2 py-1.5">
                <button
                  onClick={handleContinue}
                  className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-lg bg-codefire-orange/15 text-codefire-orange hover:bg-codefire-orange/25 transition-colors border border-codefire-orange/30"
                >
                  <Zap size={12} />
                  Continue
                </button>
                <span className="text-[10px] text-neutral-500">Tool call limit reached — continue from where it left off</span>
              </div>
            )}
            {sending && chatMode === 'agent' && (
              <AgentRunStatus
                sending={sending}
                streaming={streaming}
                toolExecutions={toolExecutions}
                confirmAction={confirmAction ? { tool: confirmAction.action, args: confirmAction.details } : null}
                startedAt={runStartedAt}
              />
            )}
            {sending && !streaming && toolExecutions.length === 0 && chatMode !== 'agent' && (
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Loader2 size={12} className="animate-spin text-neutral-500" />
                <span className="text-[10px] text-neutral-500">Thinking...</span>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Rate limit banner */}
      {rateLimitInfo && !rateLimitDismissed && (
        <div className="px-3 py-2 bg-yellow-500/10 border-t border-yellow-500/20 shrink-0">
          <div className="flex items-center gap-2">
            <AlertTriangle size={12} className="text-yellow-400 shrink-0" />
            <p className="text-[11px] text-yellow-300 flex-1">
              <span className="font-medium">{rateLimitInfo.providerName}</span> rate limited
              {rateLimitInfo.fallbackProvider && (
                <span> — using <span className="font-medium">{rateLimitInfo.fallbackProvider}</span></span>
              )}
              {rateLimitCountdown && (
                <span className="text-yellow-400/70"> (back in {rateLimitCountdown})</span>
              )}
            </p>
            {rateLimitInfo.limit !== null && rateLimitInfo.remaining !== null && (
              <span className="text-[9px] text-yellow-500/60 shrink-0">
                {rateLimitInfo.remaining}/{rateLimitInfo.limit}
              </span>
            )}
            <button
              onClick={() => setRateLimitDismissed(true)}
              className="text-yellow-500/50 hover:text-yellow-400 transition-colors shrink-0"
              title="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        </div>
      )}

      {/* Error banner */}
      {errorMessage && (
        <div className="px-3 py-2 bg-red-900/30 border-t border-red-800/50 shrink-0">
          <p className="text-[11px] text-red-300">{errorMessage}</p>
        </div>
      )}

      {/* Input area */}
      <div className="px-3 py-2.5 border-t border-neutral-800 shrink-0">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            rows={1}
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-xs text-neutral-200 placeholder-neutral-600 focus:outline-none focus:border-codefire-orange/50 resize-none max-h-24"
            placeholder={chatMode === 'agent' ? `Ask or command the agent...` : `Ask about ${projectName}...`}
            disabled={sending}
          />
          {sending && chatMode === 'agent' && activeRunId ? (
            <button
              onClick={handleCancelRun}
              className="px-3 py-2 bg-red-500/15 text-red-300 rounded-lg hover:bg-red-500/25 transition-colors self-end"
              title="Cancel active run"
            >
              <Square size={14} />
            </button>
          ) : (
            <button
              onClick={() => handleSend()}
              disabled={!input.trim() || sending}
              className="px-3 py-2 bg-codefire-orange/20 text-codefire-orange rounded-lg hover:bg-codefire-orange/30 transition-colors disabled:opacity-40 self-end"
            >
              {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Chat Bubble ─────────────────────────────────────────────────────────────

function ChatBubble({
  role,
  content,
  usage,
  tools,
  onCopy,
  onCreateTask,
  onCreateNote,
  onSendToTerminal,
}: {
  role: string
  content: string
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  tools?: ToolExecution[]
  onCopy: (content: string) => void
  onCreateTask: (content: string) => void
  onCreateNote: (content: string) => void
  onSendToTerminal: (content: string) => void
}) {
  const isUser = role === 'user'
  const [toolsExpanded, setToolsExpanded] = useState(false)

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div className="relative max-w-[90%]">
        {/* Tool executions (collapsed by default) */}
        {tools && tools.length > 0 && (
          <div className="mb-1.5">
            <button
              onClick={() => setToolsExpanded(!toolsExpanded)}
              className="flex items-center gap-1.5 text-[10px] text-neutral-500 hover:text-neutral-300 transition-colors py-0.5"
            >
              <Wrench size={10} className="text-neutral-600" />
              <span>{tools.length} tool{tools.length > 1 ? 's' : ''} used</span>
              <ChevronDown size={10} className={`transition-transform ${toolsExpanded ? 'rotate-180' : ''}`} />
            </button>
            {toolsExpanded && (
              <div className="mt-1 space-y-0.5">
                {tools.map((te, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded bg-neutral-800/60 border border-neutral-700/30">
                    {te.status === 'error' ? (
                      <X size={9} className="text-red-500 shrink-0" />
                    ) : (
                      <Wrench size={9} className="text-neutral-600 shrink-0" />
                    )}
                    <span className="text-[10px] text-neutral-400 font-mono truncate flex-1">
                      {te.name}
                    </span>
                    {te.status === 'done' && (
                      <span className="text-[9px] text-green-600/70 shrink-0">ok</span>
                    )}
                    {te.status === 'error' && (
                      <span className="text-[9px] text-red-500/70 shrink-0">err</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Message bubble */}
        <div
          className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${
            isUser
              ? 'bg-codefire-orange/15 text-neutral-200 border border-codefire-orange/20'
              : 'bg-neutral-800/80 text-neutral-300 border border-neutral-700/40'
          }`}
        >
          <MarkdownContent content={content} />
        </div>

        {/* Footer: actions + usage */}
        {!isUser && (
          <div className="flex items-center justify-between mt-1 min-h-[20px]">
            <div className="flex items-center gap-0.5">
              <ActionButton icon={<Copy size={10} />} title="Copy" onClick={() => onCopy(content)} />
              <ActionButton icon={<ListTodo size={10} />} title="Create Task" onClick={() => onCreateTask(content)} />
              <ActionButton icon={<StickyNote size={10} />} title="Add to Notes" onClick={() => onCreateNote(content)} />
              <ActionButton icon={<Terminal size={10} />} title="Copy to Clipboard" onClick={() => onSendToTerminal(content)} />
            </div>
            {usage && (usage.prompt_tokens || usage.completion_tokens) && (
              <span className="text-[9px] text-neutral-600 tabular-nums" title={`Input: ${usage.prompt_tokens ?? 0} | Output: ${usage.completion_tokens ?? 0}`}>
                {usage.prompt_tokens ?? 0}↓ {usage.completion_tokens ?? 0}↑
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function ActionButton({ icon, title, onClick }: { icon: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="p-1 rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-700/50 transition-colors"
    >
      {icon}
    </button>
  )
}

// ─── Simple Markdown Rendering ───────────────────────────────────────────────

function MarkdownContent({ content }: { content: string }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let inCodeBlock = false
  let codeBlockContent = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (inCodeBlock) {
        elements.push(
          <pre key={i} className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 my-1 overflow-x-auto text-[10px] text-neutral-300">
            <code>{codeBlockContent.trimEnd()}</code>
          </pre>
        )
        codeBlockContent = ''
        inCodeBlock = false
      } else {
        inCodeBlock = true
      }
      continue
    }

    if (inCodeBlock) {
      codeBlockContent += (codeBlockContent ? '\n' : '') + line
      continue
    }

    if (line.startsWith('### ')) {
      elements.push(<p key={i} className="font-semibold text-neutral-200 mt-2 mb-0.5">{formatInline(line.slice(4))}</p>)
    } else if (line.startsWith('## ')) {
      elements.push(<p key={i} className="font-semibold text-neutral-200 mt-2 mb-0.5">{formatInline(line.slice(3))}</p>)
    } else if (line.startsWith('# ')) {
      elements.push(<p key={i} className="font-bold text-neutral-100 mt-2 mb-1">{formatInline(line.slice(2))}</p>)
    } else if (line.match(/^[-*]\s/)) {
      elements.push(
        <p key={i} className="pl-3">
          <span className="text-neutral-600 mr-1">&bull;</span>
          {formatInline(line.replace(/^[-*]\s/, ''))}
        </p>
      )
    } else if (line.match(/^\d+\.\s/)) {
      const match = line.match(/^(\d+)\.\s(.*)/)
      if (match) {
        elements.push(
          <p key={i} className="pl-3">
            <span className="text-neutral-500 mr-1">{match[1]}.</span>
            {formatInline(match[2])}
          </p>
        )
      }
    } else if (line.startsWith('> ')) {
      elements.push(
        <p key={i} className="pl-2 border-l-2 border-neutral-600 text-neutral-400 italic">
          {formatInline(line.slice(2))}
        </p>
      )
    } else if (line.trim() === '') {
      elements.push(<div key={i} className="h-1.5" />)
    } else {
      elements.push(<p key={i} className="whitespace-pre-wrap">{formatInline(line)}</p>)
    }
  }

  if (inCodeBlock && codeBlockContent) {
    elements.push(
      <pre key="unclosed" className="bg-neutral-900 border border-neutral-700 rounded px-2 py-1.5 my-1 overflow-x-auto text-[10px] text-neutral-300">
        <code>{codeBlockContent.trimEnd()}</code>
      </pre>
    )
  }

  return <>{elements}</>
}

function formatInline(text: string): React.ReactNode {
  const parts: React.ReactNode[] = []
  let remaining = text
  let key = 0

  while (remaining.length > 0) {
    const codeMatch = remaining.match(/^(.*?)`([^`]+)`/)
    const boldMatch = remaining.match(/^(.*?)\*\*(.+?)\*\*/)
    const italicMatch = remaining.match(/^(.*?)\*(.+?)\*/)

    const matches = [
      codeMatch ? { type: 'code', match: codeMatch, index: codeMatch[1].length } : null,
      boldMatch ? { type: 'bold', match: boldMatch, index: boldMatch[1].length } : null,
      italicMatch ? { type: 'italic', match: italicMatch, index: italicMatch[1].length } : null,
    ].filter(Boolean).sort((a, b) => a!.index - b!.index)

    if (matches.length === 0) {
      parts.push(remaining)
      break
    }

    const first = matches[0]!
    if (first.match![1]) parts.push(first.match![1])

    if (first.type === 'code') {
      parts.push(<code key={key++} className="bg-neutral-800 text-codefire-orange px-1 py-0.5 rounded text-[10px]">{first.match![2]}</code>)
    } else if (first.type === 'bold') {
      parts.push(<strong key={key++} className="font-semibold text-neutral-200">{first.match![2]}</strong>)
    } else if (first.type === 'italic') {
      parts.push(<em key={key++}>{first.match![2]}</em>)
    }
    remaining = remaining.slice(first.match![0].length)
  }

  return <>{parts}</>
}
