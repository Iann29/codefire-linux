import { useState, useEffect, useRef, useCallback } from 'react'
import { Loader2, Flame, Zap, BookOpen, Wrench, Square } from 'lucide-react'
import type {
  ChatAttachment,
  ChatConversation,
  ChatEffortLevel,
  ChatMessage,
  RateLimitInfo,
  RunUsageSnapshot,
  Session,
  TokenUsage,
} from '@shared/models'
import { buildMessageContentWithAttachments } from '@shared/chatAttachments'
import { createRunUsageSnapshot, createTokenUsage, getLatestResponseUsage, getLatestRunUsage } from '@shared/chatUsage'
import { api } from '@renderer/lib/api'
import { chatComposerStore } from '@renderer/stores/chatComposerStore'
import PlanRail from './PlanRail'
import AgentRunStatus from './AgentRunStatus'
import { parseSlashCommand, formatContextCommand, getContextWindowSize, estimateTokens } from './chatCommands'
import ChatHeader, { resolveModelAlias, modelHasVision, modelSupportsClaudeEffort } from './ChatHeader'
import ChatBubble from './ChatBubble'
import type { ToolExecution } from './ChatBubble'
import ChatInput from './ChatInput'
import ChatBanners from './ChatBanners'
import ChatContextTab from './ChatContextTab'

// ─── Types ───────────────────────────────────────────────────────────────────

type ChatMode = 'context' | 'agent'

interface CodeFireChatProps {
  projectId?: string
  projectName?: string
}

interface PlanStep {
  title: string
  status: 'pending' | 'done' | 'blocked'
}

type PlanScope = 'browser' | 'general'

interface VerificationState {
  awaitingVerification: boolean
  lastBrowserAction: string | null
}

interface CompactionInfo {
  trimmedCount: number
  before: number
  after: number
}

interface AgentRuntimeOptions {
  maxToolCalls: number
  temperature: number
  effortLevel: ChatEffortLevel
  planEnforcement: boolean
  contextCompaction: boolean
}

function estimateContentTokens(content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> | unknown): number {
  if (typeof content === 'string') return estimateTokens(content)
  if (!Array.isArray(content)) return 0
  return content.reduce((sum, part) => sum + estimateTokens(part?.text ?? ''), 0)
}

function createSingleCallUsageSnapshot({
  usage,
  provider,
  model,
  effortLevel,
  capturedAt,
  source,
}: {
  usage?: TokenUsage | null
  provider?: string | null
  model?: string | null
  effortLevel?: ChatEffortLevel | null
  capturedAt?: string | null
  source: TokenUsage['source']
}): { responseUsage: TokenUsage | null; runUsage: RunUsageSnapshot | null } {
  const responseUsage = createTokenUsage(usage, { source })
  return {
    responseUsage,
    runUsage: createRunUsageSnapshot(responseUsage, {
      callCount: responseUsage ? 1 : 0,
      provider,
      model,
      effortLevel,
      capturedAt,
      source,
    }),
  }
}

function derivePersistedRunUsage(
  chatMessages: ChatMessage[],
  fallback: {
    provider: string
    model: string
    effortLevel: ChatEffortLevel
  },
): RunUsageSnapshot | null {
  const savedRunUsage = getLatestRunUsage(chatMessages)
  if (savedRunUsage) return savedRunUsage

  const latestResponseUsage = getLatestResponseUsage(chatMessages)
  const latestAssistantMessage = [...chatMessages].reverse().find((message) => message.role === 'assistant')
  if (!latestResponseUsage || !latestAssistantMessage) return null

  return createRunUsageSnapshot(latestResponseUsage, {
    callCount: 1,
    provider: latestAssistantMessage.provider ?? fallback.provider,
    model: latestAssistantMessage.model ?? fallback.model,
    effortLevel: latestAssistantMessage.effortLevel ?? fallback.effortLevel,
    capturedAt: latestAssistantMessage.usageCapturedAt ?? latestAssistantMessage.createdAt,
    source: latestResponseUsage.source ?? 'provider',
  })
}

// ─── Error Formatting ────────────────────────────────────────────────────────

function formatChatError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)

  // Authentication error
  if (raw.includes('authentication_error') || raw.includes('invalid x-api-key') || raw.includes('401')) {
    return 'Token invalido ou expirado. Gere um novo com `claude setup-token` e atualize em Settings > Engine.'
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
    return msgMatch ? `Erro na requisicao: ${msgMatch[1]}` : 'Requisicao invalida. Verifique o modelo selecionado.'
  }

  // Network errors
  if (raw.includes('fetch failed') || raw.includes('ENOTFOUND') || raw.includes('ECONNREFUSED') || raw.includes('NetworkError')) {
    return 'Sem conexao com a API. Verifique sua internet.'
  }

  // Not connected
  if (raw.includes('not connected') || raw.includes('setup-token')) {
    return 'Claude subscription nao conectado. Execute `claude setup-token` e cole o token em Settings > Engine.'
  }

  // OpenRouter key missing
  if (raw.includes('API key not configured') || raw.includes('openRouterKey')) {
    return 'API key nao configurada. Adicione sua chave em Settings > Engine.'
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
  let context = 'You are a helpful assistant integrated into Pinyino, a project management companion for AI coding agents.\n'
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
  const [chatMode, setChatMode] = useState<ChatMode>('context')
  const [chatModel, setChatModel] = useState('google/gemini-3.1-pro-preview')
  const [chatEffortLevel, setChatEffortLevel] = useState<ChatEffortLevel>('default')
  const [aiProvider, setAiProvider] = useState<string>('openrouter')
  const [toolExecutions, setToolExecutions] = useState<ToolExecution[]>([])
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [activeRequestConversationId, setActiveRequestConversationId] = useState<number | null>(null)
  const [planStepsByConversation, setPlanStepsByConversation] = useState<Record<number, PlanStep[]>>({})
  const [planScopeByConversation, setPlanScopeByConversation] = useState<Record<number, PlanScope | null>>({})
  const [verificationByConversation, setVerificationByConversation] = useState<Record<number, VerificationState>>({})
  const [compactionByConversation, setCompactionByConversation] = useState<Record<number, CompactionInfo | null>>({})
  const [runUsageByConversation, setRunUsageByConversation] = useState<Record<number, RunUsageSnapshot | null>>({})
  const [confirmAction, setConfirmAction] = useState<{ runId: string; action: string; details: Record<string, unknown> } | null>(null)
  const [continueConversationId, setContinueConversationId] = useState<number | null>(null)
  const [messageTools, setMessageTools] = useState<Record<number, ToolExecution[]>>({})
  const [rateLimitInfo, setRateLimitInfo] = useState<RateLimitInfo | null>(null)
  const [rateLimitDismissed, setRateLimitDismissed] = useState(false)
  const [rateLimitCountdown, setRateLimitCountdown] = useState('')
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null)
  const [draftAttachments, setDraftAttachments] = useState<ChatAttachment[]>([])
  const [chatSubTab, setChatSubTab] = useState<'chat' | 'context'>('chat')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const activeConversationIdRef = useRef<number | null>(null)
  const activeRunIdRef = useRef<string | null>(null)
  const runIdToConversationIdRef = useRef(new Map<string, number>())
  const pendingRunsRef = useRef(new Map<string, { resolve: () => void; reject: (error: Error) => void }>())

  // Load config for chat defaults
  useEffect(() => {
    window.api.invoke('settings:get').then((config: any) => {
      if (config?.chatMode) setChatMode(config.chatMode)
      if (config?.chatModel) setChatModel(config.chatModel)
      if (config?.chatEffortLevel) setChatEffortLevel(config.chatEffortLevel)
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

  // Consume pending attachments from the store when component mounts or store changes
  useEffect(() => {
    function consumePending() {
      const pending = chatComposerStore.consumeAttachments()
      if (pending.length > 0) {
        setDraftAttachments(prev => [...prev, ...pending])
      }
    }
    consumePending()
    return chatComposerStore.subscribe(consumePending)
  }, [])

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
      const requestedConversationId = activeConversationId
      api.chat.listMessages(requestedConversationId).then((loadedMessages) => {
        if (activeConversationIdRef.current !== requestedConversationId) return
        setMessages(loadedMessages)
        setRunUsageByConversation((prev) => {
          if (prev[requestedConversationId] !== undefined) return prev
          const derived = derivePersistedRunUsage(loadedMessages, {
            provider: aiProvider,
            model: chatModel,
            effortLevel: chatEffortLevel,
          })
          if (!derived) return prev
          return { ...prev, [requestedConversationId]: derived }
        })
      })
    } else {
      setMessages([])
    }
  }, [activeConversationId, aiProvider, chatEffortLevel, chatModel])

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId
  }, [activeConversationId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamedContent, toolExecutions])

  useEffect(() => {
    inputRef.current?.focus()
  }, [activeConversationId])

  const activePlanSteps = activeConversationId ? (planStepsByConversation[activeConversationId] ?? []) : []
  const activePlanScope = activeConversationId ? (planScopeByConversation[activeConversationId] ?? null) : null
  const activeVerification = activeConversationId
    ? (verificationByConversation[activeConversationId] ?? { awaitingVerification: false, lastBrowserAction: null })
    : { awaitingVerification: false, lastBrowserAction: null }
  const activeCompactionInfo = activeConversationId ? (compactionByConversation[activeConversationId] ?? null) : null
  const activeRunUsage = activeConversationId ? (runUsageByConversation[activeConversationId] ?? null) : null
  const showingActiveRequest = activeConversationId !== null && activeConversationId === activeRequestConversationId

  function resetConversationRuntimeState(conversationId: number) {
    setPlanStepsByConversation((prev) => ({ ...prev, [conversationId]: [] }))
    setPlanScopeByConversation((prev) => ({ ...prev, [conversationId]: null }))
    setVerificationByConversation((prev) => ({
      ...prev,
      [conversationId]: { awaitingVerification: false, lastBrowserAction: null },
    }))
    setCompactionByConversation((prev) => ({ ...prev, [conversationId]: null }))
    setRunUsageByConversation((prev) => ({ ...prev, [conversationId]: null }))
  }

  function clearConversationCaches(conversationId: number) {
    setPlanStepsByConversation((prev) => {
      const next = { ...prev }
      delete next[conversationId]
      return next
    })
    setPlanScopeByConversation((prev) => {
      const next = { ...prev }
      delete next[conversationId]
      return next
    })
    setVerificationByConversation((prev) => {
      const next = { ...prev }
      delete next[conversationId]
      return next
    })
    setCompactionByConversation((prev) => {
      const next = { ...prev }
      delete next[conversationId]
      return next
    })
    setRunUsageByConversation((prev) => {
      const next = { ...prev }
      delete next[conversationId]
      return next
    })
  }

  // Agent event listeners
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
      const conversationId = runIdToConversationIdRef.current.get(runId) ?? null
      if (!conversationId) return

      const steps = Array.isArray(payload?.plan)
        ? payload.plan
          .filter((step: any) => step && typeof step.title === 'string')
          .map((step: any) => ({
            title: String(step.title),
            status: step.status === 'done' || step.status === 'blocked' ? step.status : 'pending',
          }))
        : []

      setPlanStepsByConversation((prev) => ({ ...prev, [conversationId]: steps }))
      setPlanScopeByConversation((prev) => ({
        ...prev,
        [conversationId]: payload?.planScope === 'browser' || payload?.planScope === 'general'
          ? payload.planScope
          : prev[conversationId] ?? null,
      }))
      setVerificationByConversation((prev) => ({
        ...prev,
        [conversationId]: {
          awaitingVerification: payload?.awaitingVerification === true,
          lastBrowserAction: typeof payload?.lastBrowserAction === 'string' ? payload.lastBrowserAction : null,
        },
      }))
    })

    const cleanupUsage = window.api.on('agent:usage', (payload: any) => {
      const runId = String(payload?.runId ?? '')
      if (!runId || runId !== activeRunIdRef.current) return
      const conversationId = runIdToConversationIdRef.current.get(runId) ?? null
      if (!conversationId) return

      setRunUsageByConversation((prev) => ({
        ...prev,
        [conversationId]: {
          callCount: typeof payload?.callCount === 'number' ? payload.callCount : 0,
          lastCall: (payload?.lastCall ?? null) as TokenUsage | null,
          total: (payload?.total ?? null) as TokenUsage | null,
          provider: typeof payload?.provider === 'string' ? payload.provider : null,
          model: typeof payload?.model === 'string' ? payload.model : null,
          effortLevel: typeof payload?.effortLevel === 'string' ? payload.effortLevel as ChatEffortLevel : null,
          capturedAt: typeof payload?.capturedAt === 'string' ? payload.capturedAt : null,
          source: typeof payload?.source === 'string' ? payload.source : 'provider',
        },
      }))
    })

    const cleanupCompacted = window.api.on('agent:compacted', (payload: any) => {
      const runId = String(payload?.runId ?? '')
      if (!runId || runId !== activeRunIdRef.current) return
      const conversationId = runIdToConversationIdRef.current.get(runId) ?? null
      if (!conversationId) return

      const trimmedCount = typeof payload?.trimmedCount === 'number' ? payload.trimmedCount : 0
      const before = typeof payload?.contextUsage?.before === 'number' ? payload.contextUsage.before : 0
      const after = typeof payload?.contextUsage?.after === 'number' ? payload.contextUsage.after : 0
      setCompactionByConversation((prev) => ({
        ...prev,
        [conversationId]: { trimmedCount, before, after },
      }))
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
      const conversationId = runIdToConversationIdRef.current.get(runId) ?? null

      if (payload?.message) {
        const msg = payload.message as ChatMessage
        if (msg.conversationId === activeConversationIdRef.current) {
          setMessages((prev) => [...prev, msg])
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
      setActiveRequestConversationId(null)
      setConfirmAction(null)
      if (conversationId) {
        setVerificationByConversation((prev) => ({
          ...prev,
          [conversationId]: {
            awaitingVerification: false,
            lastBrowserAction: prev[conversationId]?.lastBrowserAction ?? null,
          },
        }))
      }
      if (payload?.runUsage && conversationId) {
        setRunUsageByConversation((prev) => ({
          ...prev,
          [conversationId]: payload.runUsage as RunUsageSnapshot,
        }))
      }

      if (payload?.hitLimit && conversationId) {
        setContinueConversationId(conversationId)
      } else if (conversationId) {
        setContinueConversationId((prev) => (prev === conversationId ? null : prev))
      }

      activeRunIdRef.current = null
      runIdToConversationIdRef.current.delete(runId)
      setActiveRunId(null)
      const pending = pendingRunsRef.current.get(runId)
      pendingRunsRef.current.delete(runId)
      pending?.resolve()
    })

    const cleanupError = window.api.on('agent:error', (payload: any) => {
      const runId = String(payload?.runId ?? '')
      if (!runId || runId !== activeRunIdRef.current) return
      const conversationId = runIdToConversationIdRef.current.get(runId) ?? null

      const pending = pendingRunsRef.current.get(runId)
      pendingRunsRef.current.delete(runId)
      activeRunIdRef.current = null
      runIdToConversationIdRef.current.delete(runId)
      setActiveRunId(null)

      setStreaming(false)
      setStreamedContent('')
      setActiveRequestConversationId(null)
      setToolExecutions([])
      setConfirmAction(null)
      if (conversationId) {
        setVerificationByConversation((prev) => ({
          ...prev,
          [conversationId]: {
            awaitingVerification: false,
            lastBrowserAction: prev[conversationId]?.lastBrowserAction ?? null,
          },
        }))
      }

      const message = String(payload?.error ?? 'Unknown agent error')
      pending?.reject(new Error(message))
    })

    return () => {
      cleanupStream()
      cleanupToolStart()
      cleanupToolResult()
      cleanupPlanUpdate()
      cleanupUsage()
      cleanupCompacted()
      cleanupConfirmAction()
      cleanupDone()
      cleanupError()
      pendingRunsRef.current.forEach(({ reject }) => reject(new Error('Agent run interrupted')))
      pendingRunsRef.current.clear()
      runIdToConversationIdRef.current.clear()
      activeRunIdRef.current = null
      setActiveRunId(null)
      setActiveRequestConversationId(null)
      setConfirmAction(null)
    }
  }, [])

  // ─── Handlers ──────────────────────────────────────────────────────────────

  async function handleNewConversation() {
    const conv = await api.chat.createConversation({
      projectId: projectId || '__global__',
      title: 'New Chat',
    })
    setConversations((prev) => [conv, ...prev])
    resetConversationRuntimeState(conv.id)
    setActiveConversationId(conv.id)
    setMessages([])
  }

  async function handleDeleteConversation(id: number, e: React.MouseEvent) {
    e.stopPropagation()
    await api.chat.deleteConversation(id)
    setConversations((prev) => prev.filter((c) => c.id !== id))
    clearConversationCaches(id)
    setContinueConversationId((prev) => (prev === id ? null : prev))
    setActiveRequestConversationId((prev) => (prev === id ? null : prev))
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

  function handleModelChange(model: string) {
    setChatModel(model)
    api.settings.set({ chatModel: model })
  }

  const handleEffortLevelChange = (level: ChatEffortLevel) => {
    setChatEffortLevel(level)
    api.settings.set({ chatEffortLevel: level })
  }

  const resolveEffortLevel = (
    provider: string,
    model: string,
    effortLevel: ChatEffortLevel,
  ): ChatEffortLevel | undefined => {
    if (provider !== 'claude-subscription') return undefined
    if (!modelSupportsClaudeEffort(model)) return undefined
    return effortLevel === 'default' ? undefined : effortLevel
  }

  // ─── Send (dispatches to mode) ─────────────────────────────────────────────

  async function handleSend(contentOverride?: string) {
    const rawContent = contentOverride || input.trim()
    if ((!rawContent && draftAttachments.length === 0) || sending) return

    // If only attachments but no text, provide a default prompt
    const effectiveContent = rawContent || (draftAttachments.length > 0 ? 'Analyze the attached file(s).' : '')
    if (!effectiveContent) return

    // Check for slash commands before sending
    const cmdResult = parseSlashCommand(effectiveContent)
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
        hasCompaction: !!activeCompactionInfo,
        compactionCount: activeCompactionInfo?.trimmedCount,
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

    const content = effectiveContent
    const attachments = [...draftAttachments]
    if (!contentOverride) setInput('')
    setDraftAttachments([])
    setSending(true)
    setRunStartedAt(Date.now())
    setErrorMessage(null)
    setActiveRequestConversationId(activeConversationId)
    setToolExecutions([])
    setContinueConversationId((prev) => (prev === activeConversationId ? null : prev))

    // Ensure conversation
    let convId = activeConversationId
    if (!convId) {
      try {
        const title = content.slice(0, 60)
        const conv = await api.chat.createConversation({ projectId: projectId || '__global__', title })
        setConversations((prev) => [conv, ...prev])
        resetConversationRuntimeState(conv.id)
        setActiveConversationId(conv.id)
        convId = conv.id
      } catch (err) {
        setErrorMessage(`Falha ao criar conversa: ${formatChatError(err)}`)
        setSending(false)
        setActiveRequestConversationId(null)
        setInput(content)
        return
      }
    }

    resetConversationRuntimeState(convId)
    setActiveRequestConversationId(convId)

    // Save user message
    let userMsg: ChatMessage
    try {
      userMsg = await api.chat.sendMessage({
        conversationId: convId,
        role: 'user',
        content,
        attachments: attachments.length > 0 ? attachments : undefined
      })
      setMessages((prev) => [...prev, userMsg])
    } catch (err) {
      setErrorMessage(`Falha ao salvar mensagem: ${formatChatError(err)}`)
      setSending(false)
      setActiveRequestConversationId(null)
      setInput(content)
      return
    }

    // Get config
    let apiKey: string | undefined
    const model = resolveModelAlias(chatModel)
    const provider = aiProvider
    let runtimeOptions: AgentRuntimeOptions = {
      maxToolCalls: 30,
      temperature: 0.7,
      effortLevel: chatEffortLevel,
      planEnforcement: true,
      contextCompaction: false,
    }
    try {
      const config = (await window.api.invoke('settings:get')) as {
        openRouterKey?: string
        chatEffortLevel?: ChatEffortLevel
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
        effortLevel: config?.chatEffortLevel ?? chatEffortLevel,
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
    const effortLevel = resolveEffortLevel(provider, model, runtimeOptions.effortLevel)

    // Only require OpenRouter key when using OpenRouter
    if (!isSubscription && !apiKey) {
      const noKeyMessage = `**OpenRouter API key required**\n\nTo use the Pinyino agent, add your API key in **Settings** > **Engine** tab.`
      try {
        const errorMsg = await api.chat.sendMessage({ conversationId: convId, role: 'assistant', content: noKeyMessage })
        setMessages((prev) => [...prev, errorMsg])
      } catch {
        setMessages((prev) => [...prev, { id: -1, conversationId: convId, role: 'assistant', content: noKeyMessage, createdAt: new Date().toISOString() }])
      }
      setSending(false)
      setActiveRequestConversationId(null)
      return
    }

    try {
      if (chatMode === 'agent') {
        await handleAgentModeMain(
          convId,
          content,
          userMsg,
          apiKey ?? '',
          model,
          { ...runtimeOptions, effortLevel: effortLevel ?? 'default' },
          attachments,
        )
      } else if (isSubscription) {
        await handleContextModeProvider(convId, content, userMsg, model, effortLevel, attachments)
      } else {
        await handleContextMode(convId, content, userMsg, apiKey!, model, attachments)
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
      setActiveRequestConversationId(null)
      setToolExecutions([])
    }
  }

  // ─── Context Mode (Swift parity — RAG + context stuffing) ──────────────────

  async function handleContextMode(
    convId: number,
    _userContent: string,
    userMsg: ChatMessage,
    apiKey: string,
    model: string,
    _attachments: ChatAttachment[] = []
  ) {
    const context = await buildContextWithRAG(projectId, projectName, _userContent, isGlobal)
    const allMessages = [...messages, userMsg]
    let historyChars = 0
    const history: { role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }[] = []
    const allowImages = modelHasVision(model)
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const m = allMessages[i]
      const content = buildMessageContentWithAttachments(m.content, m.attachments, { allowImages })
      const contentLength = estimateContentTokens(content)
      if (historyChars + contentLength > 25000) break
      history.unshift({ role: m.role, content })
      historyChars += contentLength
    }

    setStreaming(true)
    setStreamedContent('')

    const fullContent = await streamChat(apiKey, model, [
      { role: 'system', content: context },
      ...history.slice(-20),
    ] as Array<{ role: string; content: string }>)

    setStreaming(false)
    setStreamedContent('')

    if (fullContent) {
      const usageCapturedAt = new Date().toISOString()
      const estimatedUsage = createTokenUsage({
        prompt_tokens: estimateContentTokens(context) + history.reduce((sum, message) => sum + estimateContentTokens(message.content), 0),
        completion_tokens: estimateTokens(fullContent),
      }, { source: 'estimated' })
      const { responseUsage, runUsage } = createSingleCallUsageSnapshot({
        usage: estimatedUsage,
        provider: aiProvider,
        model,
        effortLevel: null,
        capturedAt: usageCapturedAt,
        source: 'estimated',
      })
        const assistantMsg = await api.chat.sendMessage({
          conversationId: convId,
          role: 'assistant',
          content: fullContent,
        responseUsage,
        runUsage,
        provider: aiProvider,
        model,
        effortLevel: null,
        usageCapturedAt,
      })
      if (convId === activeConversationIdRef.current) {
        setMessages((prev) => [...prev, assistantMsg])
      }
      setRunUsageByConversation((prev) => ({ ...prev, [convId]: runUsage }))
      updateConversationTitle(convId, _userContent)
    }
  }

  // ─── Context Mode via ProviderRouter (subscription providers) ──────────────

  async function handleContextModeProvider(
    convId: number,
    _userContent: string,
    userMsg: ChatMessage,
    model: string,
    effortLevel?: ChatEffortLevel,
    _attachments: ChatAttachment[] = []
  ) {
    const context = await buildContextWithRAG(projectId, projectName, _userContent, isGlobal)
    const allMessages = [...messages, userMsg]
    let historyChars = 0
    const history: { role: string; content: string | Array<{ type: string; text?: string; image_url?: { url: string } }> }[] = []
    const allowImages = modelHasVision(model)
    for (let i = allMessages.length - 1; i >= 0; i--) {
      const m = allMessages[i]
      const content = buildMessageContentWithAttachments(m.content, m.attachments, { allowImages })
      const contentLength = estimateContentTokens(content)
      if (historyChars + contentLength > 25000) break
      history.unshift({ role: m.role, content })
      historyChars += contentLength
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
        effortLevel,
      } as any)

      cleanupChunk()
      setStreaming(false)
      setStreamedContent('')

      if (result.content) {
        const usageCapturedAt = new Date().toISOString()
        const { responseUsage, runUsage } = createSingleCallUsageSnapshot({
          usage: result.usage ?? null,
          provider: aiProvider,
          model,
          effortLevel: effortLevel ?? null,
          capturedAt: usageCapturedAt,
          source: result.usage?.source ?? 'provider',
        })
        const assistantMsg = await api.chat.sendMessage({
          conversationId: convId,
          role: 'assistant',
          content: result.content,
          responseUsage,
          runUsage,
          provider: result.providerId ?? aiProvider,
          model,
          effortLevel: effortLevel ?? null,
          usageCapturedAt,
        })
        if (convId === activeConversationIdRef.current) {
          setMessages((prev) => [...prev, assistantMsg])
        }
        setRunUsageByConversation((prev) => ({ ...prev, [convId]: runUsage }))
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
    runtimeOptions: AgentRuntimeOptions,
    attachments: ChatAttachment[] = []
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
        effortLevel: runtimeOptions.effortLevel,
        planEnforcement: runtimeOptions.planEnforcement,
        contextCompaction: runtimeOptions.contextCompaction,
        attachments: attachments.length > 0 ? attachments : undefined,
      })
    } catch (error) {
      activeRunIdRef.current = null
      setActiveRunId(null)
      setStreaming(false)
      setStreamedContent('')
      throw new Error('Agent service not ready. Please try again in a moment.')
    }

    activeRunIdRef.current = started.runId
    runIdToConversationIdRef.current.set(started.runId, convId)
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
    messages: Array<{ role: string; content: string | unknown }>
  ): Promise<string> {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Title': 'Pinyino',
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
    setContinueConversationId(null)
    setSending(true)
    setRunStartedAt(Date.now())
    setStreaming(true)
    setStreamedContent('')
    setErrorMessage(null)
    setActiveRequestConversationId(activeConversationId)
    setToolExecutions([])
    resetConversationRuntimeState(activeConversationId)

    try {
      const started = await api.agent.continue(activeConversationId, projectId || null)
      activeRunIdRef.current = started.runId
      runIdToConversationIdRef.current.set(started.runId, activeConversationId)
      setActiveRunId(started.runId)

      await new Promise<void>((resolve, reject) => {
        pendingRunsRef.current.set(started.runId, { resolve, reject })
      })
    } catch (err) {
      activeRunIdRef.current = null
      setActiveRunId(null)
      setStreaming(false)
      setStreamedContent('')
      setActiveRequestConversationId(null)
      const friendlyError = err instanceof Error ? err.message : String(err)
      setMessages((prev) => [...prev, {
        id: -Date.now(), conversationId: activeConversationId, role: 'assistant',
        content: `**Error continuing:** ${friendlyError}`, createdAt: new Date().toISOString(),
      }])
    } finally {
      setSending(false)
      setRunStartedAt(null)
      setActiveRequestConversationId(null)
    }
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-neutral-900">
      <ChatHeader
        chatMode={chatMode}
        onToggleMode={toggleMode}
        chatModel={chatModel}
        onModelChange={handleModelChange}
        chatEffortLevel={chatEffortLevel}
        onEffortLevelChange={handleEffortLevelChange}
        aiProvider={aiProvider}
        conversations={conversations}
        sessions={sessions}
        activeConversationId={activeConversationId}
        onSelectConversation={setActiveConversationId}
        onNewConversation={handleNewConversation}
        onDeleteConversation={handleDeleteConversation}
      />

      {/* Sub-tab toggle */}
      <div className="flex border-b border-neutral-800 px-2">
        <button
          onClick={() => setChatSubTab('chat')}
          className={`px-3 py-1.5 text-[10px] font-medium border-b-2 transition-colors ${
            chatSubTab === 'chat' ? 'border-codefire-orange text-neutral-200' : 'border-transparent text-neutral-500 hover:text-neutral-400'
          }`}
        >
          Chat
        </button>
        <button
          onClick={() => setChatSubTab('context')}
          className={`px-3 py-1.5 text-[10px] font-medium border-b-2 transition-colors ${
            chatSubTab === 'context' ? 'border-codefire-orange text-neutral-200' : 'border-transparent text-neutral-500 hover:text-neutral-400'
          }`}
        >
          Context
        </button>
      </div>

      {chatSubTab === 'context' ? (
        <ChatContextTab
          messages={messages}
          compactionInfo={activeCompactionInfo}
          chatModel={chatModel}
          aiProvider={aiProvider}
          effortLevel={chatEffortLevel}
          runUsage={activeRunUsage}
        />
      ) : (
      <>
      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {!activeConversationId && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Flame size={28} className="text-neutral-700 mb-3" />
            <p className="text-xs text-neutral-500 mb-1">Pinyino Agent</p>
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
                usage={msg.responseUsage ?? undefined}
                tools={messageTools[msg.id]}
                attachments={msg.attachments}
                onCopy={handleCopyMessage}
                onCreateTask={handleCreateTask}
                onCreateNote={handleCreateNote}
                onSendToTerminal={handleSendToTerminal}
              />
            ))}
            {showingActiveRequest && streaming && streamedContent && (
              <ChatBubble
                role="assistant"
                content={streamedContent}
                onCopy={handleCopyMessage}
                onCreateTask={handleCreateTask}
                onCreateNote={handleCreateNote}
                onSendToTerminal={handleSendToTerminal}
              />
            )}
            {showingActiveRequest && toolExecutions.length > 0 && (
              <div className="space-y-1">
                {toolExecutions.map((te, i) => (
                  <div key={i} className="px-2 py-1 rounded bg-neutral-800/50 border border-neutral-700/50">
                    <div className="flex items-center gap-2">
                      {te.status === 'running' ? (
                        <Loader2 size={10} className="animate-spin text-codefire-orange shrink-0" />
                      ) : te.status === 'error' ? (
                        <Wrench size={10} className="text-red-500 shrink-0" />
                      ) : (
                        <Wrench size={10} className="text-neutral-500 shrink-0" />
                      )}
                      <span className="text-[10px] text-neutral-400 font-mono truncate">
                        {te.name}({Object.keys(te.args).length > 0 ? Object.entries(te.args).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ').slice(0, 60) : ''})
                      </span>
                      {te.status === 'done' && (
                        <span className="text-[9px] text-green-600 shrink-0">done</span>
                      )}
                      {te.status === 'error' && (
                        <span className="text-[9px] text-red-500 shrink-0">error</span>
                      )}
                    </div>
                    {te.status === 'error' && te.result && (
                      <div className="mt-1 text-[9px] text-red-400/80 font-mono break-words line-clamp-2">
                        {te.result}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {showingActiveRequest && confirmAction && (
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
            {chatMode === 'agent' && activePlanScope === 'browser' && activePlanSteps.length > 0 && (
              <PlanRail
                steps={activePlanSteps}
                awaitingVerification={activeVerification.awaitingVerification}
                lastBrowserAction={activeVerification.lastBrowserAction}
              />
            )}
            {activeCompactionInfo && (
              <div className="flex items-center gap-2 px-2 py-1 rounded bg-blue-900/20 border border-blue-800/30">
                <span className="text-[10px] text-blue-400">
                  Context compacted: {activeCompactionInfo.trimmedCount} messages summarized ({Math.round(activeCompactionInfo.before / 1000)}k → {Math.round(activeCompactionInfo.after / 1000)}k tokens)
                </span>
              </div>
            )}
            {continueConversationId === activeConversationId && !sending && chatMode === 'agent' && (
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
            {showingActiveRequest && sending && chatMode === 'agent' && (
              <AgentRunStatus
                sending={sending}
                streaming={streaming}
                toolExecutions={toolExecutions}
                confirmAction={confirmAction ? { tool: confirmAction.action, args: confirmAction.details } : null}
                startedAt={runStartedAt}
              />
            )}
            {showingActiveRequest && sending && !streaming && toolExecutions.length === 0 && chatMode !== 'agent' && (
              <div className="flex items-center gap-2 px-2 py-1.5">
                <Loader2 size={12} className="animate-spin text-neutral-500" />
                <span className="text-[10px] text-neutral-500">Thinking...</span>
              </div>
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      <ChatBanners
        rateLimitInfo={rateLimitInfo}
        rateLimitDismissed={rateLimitDismissed}
        rateLimitCountdown={rateLimitCountdown}
        onDismissRateLimit={() => setRateLimitDismissed(true)}
        errorMessage={errorMessage}
      />

      <ChatInput
        input={input}
        onInputChange={setInput}
        onSend={handleSend}
        onCancel={handleCancelRun}
        sending={sending}
        streaming={streaming}
        chatMode={chatMode}
        chatModel={chatModel}
        activeRunId={activeRunId}
        draftAttachments={draftAttachments}
        onAddAttachment={(att) => setDraftAttachments(prev => [...prev, att])}
        onRemoveAttachment={(id) => setDraftAttachments(prev => prev.filter(a => a.id !== id))}
        inputRef={inputRef}
        projectName={projectName}
      />
      </>
      )}
    </div>
  )
}
