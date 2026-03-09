import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { ipcMain, session, webContents } from 'electron'
import type {
  ChatAttachment,
  ChatEffortLevel,
  ChatMessage,
  RunUsageSnapshot,
  TokenUsage,
} from '@shared/models'
import { TaskDAO } from '../database/dao/TaskDAO'
import { NoteDAO } from '../database/dao/NoteDAO'
import { SessionDAO } from '../database/dao/SessionDAO'
import { ProjectDAO } from '../database/dao/ProjectDAO'
import type { SearchEngine } from './SearchEngine'
import { GitService } from './GitService'
import { BrowserBridge } from './BrowserBridge'
import { readConfig } from './ConfigStore'
import { ProviderRouter } from './providers/ProviderRouter'
import type { ChatCompletionToolCall as ToolCall } from './providers/BaseProvider'
import { ContextCompactor } from './ContextCompactor'
import { AgentMetrics } from './AgentMetrics'
import { FileToolService } from './tools/files/FileToolService'
import { CodebaseToolService } from './tools/codebase/CodebaseToolService'
import { ReferenceGraphService } from './tools/codebase/ReferenceGraphService'
import { WebProjectToolService } from './tools/codebase/WebProjectToolService'
import { ToolRegistry } from './tools/ToolRegistry'
import { createDataTools } from './tools/definitions/data-tools'
import { createGitTools } from './tools/definitions/git-tools'
import { createFileTools } from './tools/definitions/file-tools'
import { createCodebaseTools } from './tools/definitions/codebase-tools'
import { createWebProjectTools } from './tools/definitions/web-project-tools'
import {
  createBrowserToolSchemas,
  createPlanToolSchemas,
  BROWSER_TOOL_NAMES,
  VERIFICATION_BROWSER_TOOLS,
  URL_BEARING_TOOLS,
  DESTRUCTIVE_BROWSER_TOOLS,
} from './tools/definitions/browser-tools'

type AgentEventChannel =
  | 'agent:stream'
  | 'agent:toolStart'
  | 'agent:toolResult'
  | 'agent:planUpdate'
  | 'agent:usage'
  | 'agent:compacted'
  | 'agent:done'
  | 'agent:error'

interface AgentPlanStep {
  title: string
  status: 'pending' | 'done' | 'blocked'
}

type AgentPlanScope = 'browser' | 'general'

interface AgentUsageState {
  callCount: number
  lastCall: TokenUsage | null
  total: TokenUsage | null
  capturedAt: string | null
}

interface ActiveRun {
  id: string
  conversationId: number
  senderWebContentsId: number
  startedAt: string
  abortController: AbortController
  projectId: string | null
  plan: AgentPlanStep[] | null
  planScope: AgentPlanScope | null
  awaitingVerification: boolean
  lastBrowserAction: string | null
  browserIntentDetected: boolean
  planEnforcement: boolean
  contextCompaction: boolean
  provider: string | null
  model: string
  effortLevel: ChatEffortLevel
  usage: AgentUsageState
  attachments?: ChatAttachment[]
}

export interface AgentRunStatus {
  status: 'idle' | 'running'
  runId?: string
  conversationId?: number
  startedAt?: string
  metrics?: object
}

export interface AgentStartInput {
  conversationId: number
  userMessage: string
  senderWebContentsId: number
  projectId?: string | null
  projectName?: string
  model?: string
  apiKey?: string
  maxIterations?: number
  temperature?: number
  effortLevel?: ChatEffortLevel
  planEnforcement?: boolean
  contextCompaction?: boolean
  attachments?: ChatAttachment[]
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6'
const MAX_HISTORY_CHARS = 25_000
const DEFAULT_MAX_ITERATIONS = 30
const MAX_MAX_ITERATIONS = 100
const RETRY_MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1000
const RETRY_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

/* Tool schemas and execution are now managed by ToolRegistry.
 * See tools/definitions/ for schema + execute modules.
 * Plan and browser tools keep special routing here.
 */

// Re-export for backwards compatibility (these are now defined in browser-tools.ts)
export { URL_BEARING_TOOLS, DESTRUCTIVE_BROWSER_TOOLS }

/** Timeout for user confirmation prompt (30 seconds). */
const CONFIRMATION_TIMEOUT_MS = 30_000

/** Domains blocked by default for browser agent safety. */
export const DEFAULT_BLOCKED_DOMAINS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  'mail.google.com',
  'accounts.google.com',
  'myaccount.google.com',
  'pay.google.com',
  'banking.',
  'bank.',
  'chase.com',
  'wellsfargo.com',
  'bankofamerica.com',
  'citi.com',
  'paypal.com',
  'venmo.com',
  'stripe.com',
  'dashboard.stripe.com',
  'admin.',
  'console.aws.amazon.com',
  'portal.azure.com',
  'console.cloud.google.com',
]

/**
 * Validate a URL against a blocklist (pure logic, no config dependency).
 * Returns null if allowed, or an error string if blocked.
 */
export function validateBrowserUrl(
  url: string,
  blockedDomains: string[] = DEFAULT_BLOCKED_DOMAINS,
  allowedDomains?: string[]
): string | null {
  let hostname: string
  try {
    hostname = new URL(url).hostname.toLowerCase()
  } catch {
    return `Invalid URL: ${url}`
  }

  // Check blocklist
  for (const blocked of blockedDomains) {
    if (hostname === blocked || hostname.endsWith('.' + blocked) || hostname.startsWith(blocked)) {
      return `Domain "${hostname}" is blocked for browser agent safety. Remove from blocklist in settings if needed.`
    }
  }

  // Check allowlist: if configured, only listed domains are allowed
  if (allowedDomains && allowedDomains.length > 0) {
    const isAllowed = allowedDomains.some((pattern) => {
      const p = pattern.toLowerCase()
      return hostname === p || hostname.endsWith('.' + p)
    })
    if (!isAllowed) {
      return `Domain "${hostname}" is not in the allowed domains list. Add it in Settings > Browser > Allowed Domains.`
    }
  }

  return null
}

export class AgentService {
  private readonly taskDAO: TaskDAO
  private readonly noteDAO: NoteDAO
  private readonly sessionDAO: SessionDAO
  private readonly projectDAO: ProjectDAO
  private readonly fileToolService = new FileToolService()
  private readonly codebaseToolService: CodebaseToolService
  private readonly referenceGraphService = new ReferenceGraphService()
  private readonly webProjectToolService = new WebProjectToolService()
  private readonly toolRegistry: ToolRegistry
  private providerRouter: ProviderRouter
  private readonly contextCompactor = new ContextCompactor()
  private readonly metrics = new AgentMetrics()
  private activeRun: ActiveRun | null = null

  /** Cached provider-compatible tool schema array */
  private cachedProviderSchemas: Record<string, unknown>[] | null = null

  constructor(
    private readonly db: Database.Database,
    private readonly gitService: GitService,
    private readonly browserBridge: BrowserBridge,
    private readonly searchEngine?: SearchEngine
  ) {
    this.providerRouter = new ProviderRouter()
    this.taskDAO = new TaskDAO(db)
    this.noteDAO = new NoteDAO(db)
    this.sessionDAO = new SessionDAO(db)
    this.projectDAO = new ProjectDAO(db)
    this.codebaseToolService = new CodebaseToolService(db)

    // Build the tool registry
    this.toolRegistry = new ToolRegistry()
    this.toolRegistry.registerAll(createDataTools({
      taskDAO: this.taskDAO,
      noteDAO: this.noteDAO,
      sessionDAO: this.sessionDAO,
      projectDAO: this.projectDAO,
    }))
    this.toolRegistry.registerAll(createGitTools(this.gitService))
    this.toolRegistry.registerAll(createFileTools(this.fileToolService))
    this.toolRegistry.registerAll(createCodebaseTools({
      codebaseToolService: this.codebaseToolService,
      searchEngine: this.searchEngine,
      referenceGraph: this.referenceGraphService,
    }))
    this.toolRegistry.registerAll(createWebProjectTools(this.webProjectToolService))
  }

  setProviderRouter(router: ProviderRouter): void {
    this.providerRouter = router
  }

  /** Get the complete list of tool schemas for provider API calls */
  private getProviderSchemas(): ReadonlyArray<Record<string, unknown>> {
    if (!this.cachedProviderSchemas) {
      this.cachedProviderSchemas = [
        ...createPlanToolSchemas(),
        ...this.toolRegistry.toProviderSchemas(),
        ...createBrowserToolSchemas(),
      ] as unknown as Record<string, unknown>[]
    }
    return this.cachedProviderSchemas
  }

  startRun(input: AgentStartInput): { runId: string } {
    if (this.activeRun) {
      throw new Error('Another agent run is already in progress')
    }

    const run: ActiveRun = {
      id: randomUUID(),
      conversationId: input.conversationId,
      senderWebContentsId: input.senderWebContentsId,
      startedAt: new Date().toISOString(),
      abortController: new AbortController(),
      projectId: input.projectId ?? null,
      plan: null,
      planScope: null,
      awaitingVerification: false,
      lastBrowserAction: null,
      browserIntentDetected: this.detectBrowserIntent(input.userMessage),
      planEnforcement: true,
      contextCompaction: false,
      provider: null,
      model: input.model || DEFAULT_MODEL,
      effortLevel: input.effortLevel ?? 'default',
      usage: {
        callCount: 0,
        lastCall: null,
        total: null,
        capturedAt: null,
      },
      attachments: input.attachments,
    }

    this.activeRun = run
    void this.executeRun(run, input)
    return { runId: run.id }
  }

  cancelRun(runId?: string): { cancelled: boolean } {
    if (!this.activeRun) return { cancelled: false }
    if (runId && this.activeRun.id !== runId) return { cancelled: false }
    this.activeRun.abortController.abort()
    return { cancelled: true }
  }

  continueRun(input: {
    conversationId: number
    projectId?: string | null
    senderWebContentsId: number
  }): { runId: string } {
    if (this.activeRun) {
      throw new Error('Another agent run is already in progress')
    }

    // Reuse the existing conversation history by starting a new run
    // with a "continue" user message that won't be saved separately
    return this.startRun({
      conversationId: input.conversationId,
      userMessage: 'Continue from where you left off. Complete the remaining steps.',
      senderWebContentsId: input.senderWebContentsId,
      projectId: input.projectId ?? null,
    })
  }

  getStatus(): AgentRunStatus {
    if (!this.activeRun) return { status: 'idle', metrics: this.metrics.toJSON() }
    return {
      status: 'running',
      runId: this.activeRun.id,
      conversationId: this.activeRun.conversationId,
      startedAt: this.activeRun.startedAt,
    }
  }

  private async executeRun(run: ActiveRun, input: AgentStartInput): Promise<void> {
    this.metrics.recordRunStart()
    try {
      const config = readConfig()
      const providerOverrides = { apiKey: input.apiKey }

      const projectName = input.projectName || this.resolveProjectName(run.projectId)
      const projectPath = this.resolveProjectPath(run.projectId)
      const model = input.model || config.chatModel || DEFAULT_MODEL
      const maxIterations = clampNumber(
        input.maxIterations ?? config.agentMaxToolCalls ?? DEFAULT_MAX_ITERATIONS,
        1,
        MAX_MAX_ITERATIONS
      )
      const temperature = clampNumber(input.temperature ?? config.agentTemperature ?? 0.7, 0, 1)
      run.planEnforcement = input.planEnforcement ?? config.agentPlanEnforcement ?? true
      run.contextCompaction = input.contextCompaction ?? config.agentContextCompaction ?? false
      run.provider = config.aiProvider || 'openrouter'
      run.model = model
      run.effortLevel = input.effortLevel ?? config.chatEffortLevel ?? 'default'

      const history: Array<{ role: string; content: string | Array<Record<string, unknown>> }> =
        this.buildConversationHistory(run.conversationId)

      // Inject attachments as multimodal content into the last user message
      if (run.attachments && run.attachments.length > 0) {
        const imageAttachments = run.attachments.filter(a => a.kind === 'image')
        if (imageAttachments.length > 0 && history.length > 0) {
          const lastMsg = history[history.length - 1]
          if (lastMsg.role === 'user') {
            const parts: Array<Record<string, unknown>> = []
            for (const img of imageAttachments) {
              const base64Match = img.dataUrl.match(/^data:([^;]+);base64,(.+)$/)
              if (base64Match) {
                parts.push({
                  type: 'image_url',
                  image_url: {
                    url: img.dataUrl,
                  },
                })
              }
            }
            parts.push({
              type: 'text',
              text: typeof lastMsg.content === 'string' ? lastMsg.content : '',
            })
            lastMsg.content = parts
          }
        }
      }

      let loopMessages: Array<Record<string, unknown>> = [
        { role: 'system', content: this.buildSystemPrompt(projectName, run.planEnforcement, projectPath, run.browserIntentDetected) },
        ...history,
      ]

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        this.throwIfAborted(run.abortController.signal)

        // Enhanced system prompt: inject current browser URL context per iteration
        const browserContext = await this.getBrowserContext()
        if (browserContext) {
          loopMessages[0] = {
            role: 'system',
            content: this.buildSystemPrompt(projectName, run.planEnforcement, projectPath, run.browserIntentDetected) + '\n\n' + browserContext,
          }
        }

        const response = await this.chatCompletionWithRetry(config, {
          model,
          temperature,
          messages: loopMessages,
          tools: this.getProviderSchemas(),
          effortLevel: run.effortLevel,
          signal: run.abortController.signal,
        }, providerOverrides)
        this.recordRunUsage(run, response.usage ?? null)

        const message = response.choices?.[0]?.message
        if (!message) throw new Error('No response from model')

        let toolCalls: ToolCall[] = Array.isArray(message.tool_calls) ? message.tool_calls : []
        const assistantContent = normalizeAssistantContent(message.content)

        // XML tool call recovery: if no structured tool calls but content contains XML tool patterns
        if (toolCalls.length === 0 && assistantContent) {
          const recovered = this.recoverToolCallsFromXML(assistantContent)
          if (recovered && recovered.length > 0) {
            console.log(`[AgentService] Recovered ${recovered.length} tool call(s) from XML in response`)
            toolCalls = recovered
          }
        }

        if (toolCalls.length === 0) {
          const finalContent = assistantContent || 'Done.'
          const responseUsage = normalizeUsage(response.usage ?? null)
          const runUsage = this.buildRunUsageSnapshot(run)
          const usageCapturedAt = runUsage?.capturedAt ?? new Date().toISOString()
          this.sendEvent(run, 'agent:stream', {
            runId: run.id,
            channel: 'text',
            delta: finalContent,
          })

          const savedMessage = this.saveAssistantMessage(run.conversationId, finalContent, {
            responseUsage,
            runUsage,
            provider: run.provider,
            model: run.model,
            effortLevel: run.effortLevel,
            usageCapturedAt,
          })
          this.sendEvent(run, 'agent:done', {
            runId: run.id,
            cancelled: false,
            message: savedMessage,
            usage: responseUsage,
            runUsage,
            planScope: run.planScope,
          })
          return
        }

        loopMessages.push({
          role: 'assistant',
          content: assistantContent || null,
          tool_calls: toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: toolCall.function,
          })),
        })

        for (const toolCall of toolCalls) {
          this.throwIfAborted(run.abortController.signal)

          const fnName = toolCall.function.name
          const args = parseJsonObject(toolCall.function.arguments)
          const startedAt = Date.now()

          this.sendEvent(run, 'agent:toolStart', {
            runId: run.id,
            callId: toolCall.id,
            name: fnName,
            args,
          })

          let result: string
          let status: 'done' | 'error' = 'done'

          try {
            result = await this.executeToolCall(run, fnName, args, {
              projectId: run.projectId,
              projectPath,
            })
          } catch (error) {
            status = 'error'
            const message = error instanceof Error ? error.message : String(error)
            result = JSON.stringify({ error: message })
          }
          const durationMs = Date.now() - startedAt
          console.log(`[AgentService] tool ${fnName} (${status}) ${durationMs}ms`)

          const toolDef = this.toolRegistry.get(fnName)
          const argsStr = toolCall.function.arguments ?? ''
          this.metrics.recordToolCallDetailed(
            fnName,
            durationMs,
            status === 'error' ? 'error' : 'done',
            toolDef?.category ?? null,
            Buffer.byteLength(argsStr, 'utf8'),
            Buffer.byteLength(result, 'utf8'),
            status === 'error' ? result : undefined,
          )

          this.sendEvent(run, 'agent:toolResult', {
            runId: run.id,
            callId: toolCall.id,
            name: fnName,
            status,
            result: result.slice(0, 8_000),
            durationMs,
          })

          loopMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: result,
          })
        }

        // Context compaction: check if we need to compact before next iteration
        if (run.contextCompaction && this.contextCompactor.shouldCompact(loopMessages)) {
          const cutPoint = this.contextCompactor.findCutPoint(loopMessages)
          const serialized = this.contextCompactor.serializeForSummary(loopMessages.slice(1, cutPoint))
          const summaryPrompt = this.contextCompactor.buildSummarizationPrompt(serialized)

          try {
            const summaryResponse = await this.chatCompletionWithRetry(config, {
              model,
              temperature: 0.3,
              messages: [
                { role: 'system', content: 'You are a conversation summarizer. Be concise and structured.' },
                { role: 'user', content: summaryPrompt },
              ],
              effortLevel: run.effortLevel,
              signal: run.abortController.signal,
            }, providerOverrides)
            this.recordRunUsage(run, summaryResponse.usage ?? null)

            const summary = normalizeAssistantContent(summaryResponse.choices?.[0]?.message?.content) || 'Summary unavailable.'
            const result = this.contextCompactor.applyCompaction(loopMessages, summary, cutPoint)
            loopMessages = result.messages

            this.sendEvent(run, 'agent:compacted', {
              runId: run.id,
              trimmedCount: result.trimmedCount,
              preservedCount: result.preservedCount,
              contextUsage: result.contextUsage,
            })

            console.log(`[AgentService] Context compacted: ${result.trimmedCount} messages trimmed, ${result.contextUsage.before} → ${result.contextUsage.after} tokens`)
          } catch (err) {
            console.error('[AgentService] Compaction failed, continuing without:', err)
          }
        }
      }

      const fallback = 'I reached the maximum number of tool calls. You can continue from where I left off.'
      const runUsage = this.buildRunUsageSnapshot(run)
      this.sendEvent(run, 'agent:stream', {
        runId: run.id,
        channel: 'text',
        delta: fallback,
      })
      const savedMessage = this.saveAssistantMessage(run.conversationId, fallback, {
        responseUsage: null,
        runUsage,
        provider: run.provider,
        model: run.model,
        effortLevel: run.effortLevel,
        usageCapturedAt: runUsage?.capturedAt ?? new Date().toISOString(),
      })
      this.sendEvent(run, 'agent:done', {
        runId: run.id,
        cancelled: false,
        message: savedMessage,
        usage: null,
        runUsage,
        planScope: run.planScope,
        hitLimit: true,
      })
    } catch (error) {
      if (isAbortError(error)) {
        this.sendEvent(run, 'agent:done', {
          runId: run.id,
          cancelled: true,
          message: null,
          usage: null,
        })
      } else {
        const message = error instanceof Error ? error.message : String(error)
        this.sendEvent(run, 'agent:error', {
          runId: run.id,
          error: message,
        })
      }
    } finally {
      this.metrics.recordRunEnd()
      if (this.activeRun?.id === run.id) {
        this.activeRun = null
      }
    }
  }

  /**
   * Enhanced system prompt: get current browser URL + title for context injection.
   */
  private async getBrowserContext(): Promise<string | null> {
    try {
      const result = await this.browserBridge.executeCommand({
        tool: 'browser_get_content',
        args: { mode: 'url' },
        projectId: null,
        timeoutMs: 2000,
      })
      if (result && typeof result === 'object' && 'url' in (result as Record<string, unknown>)) {
        const r = result as Record<string, unknown>
        const url = r.url as string
        const title = r.title as string | undefined
        if (url && url !== 'about:blank') {
          return `[Browser context] Current page: ${title ? `"${title}" at ` : ''}${url}`
        }
      }
    } catch { /* browser not available, skip context */ }
    return null
  }

  /**
   * Retry engine: exponential backoff with jitter for transient errors (429, 5xx).
   * Routes through ProviderRouter.chatCompletion() which handles fallback + circuit breaker.
   */
  private async chatCompletionWithRetry(
    config: import('@shared/models').AppConfig,
    request: import('./providers/BaseProvider').ChatCompletionRequest,
    overrides?: { apiKey?: string }
  ): Promise<import('./providers/BaseProvider').ChatCompletionResponse> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
      try {
        // ProviderRouter.chatCompletion handles fallback + circuit breaker internally
        const response = await this.providerRouter.chatCompletion(config, request, overrides)
        return response
      } catch (err) {
        if (isAbortError(err)) throw err

        lastError = err instanceof Error ? err : new Error(String(err))
        const statusMatch = lastError.message.match(/\b(\d{3})\b/)
        const statusCode = statusMatch ? Number(statusMatch[1]) : 0

        if (!RETRY_RETRYABLE_STATUS.has(statusCode) && attempt === 0 && !lastError.message.includes('fetch failed')) {
          throw lastError
        }

        if (attempt < RETRY_MAX_ATTEMPTS - 1) {
          const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500
          console.log(`[AgentService] Retry ${attempt + 1}/${RETRY_MAX_ATTEMPTS} after ${Math.round(delay)}ms: ${lastError.message.slice(0, 100)}`)
          await new Promise((resolve) => setTimeout(resolve, delay))
        }
      }
    }

    throw lastError ?? new Error('All retry attempts failed')
  }

  /**
   * XML tool call recovery: parse tool calls from XML when structured output fails.
   * Some models wrap tool calls in <tool_call>, <function_call>, or <tool_use> XML.
   */
  private recoverToolCallsFromXML(content: string): ToolCall[] | null {
    // Match patterns like <tool_call>{"name":"...", "arguments":{...}}</tool_call>
    // or <function_call name="...">{"arg": "val"}</function_call>
    const patterns = [
      /<tool_call>\s*({[\s\S]*?})\s*<\/tool_call>/g,
      /<function_call[^>]*>\s*({[\s\S]*?})\s*<\/function_call>/g,
      /<tool_use[^>]*>\s*({[\s\S]*?})\s*<\/tool_use>/g,
    ]

    const calls: ToolCall[] = []

    for (const pattern of patterns) {
      let match: RegExpExecArray | null
      while ((match = pattern.exec(content)) !== null) {
        try {
          const parsed = JSON.parse(match[1]) as Record<string, unknown>
          const name = (parsed.name as string) ?? (parsed.function as string)
          const args = parsed.arguments ?? parsed.input ?? parsed.params ?? {}

          if (name) {
            calls.push({
              id: `call_xml_${calls.length}_${Math.random().toString(36).slice(2, 8)}`,
              type: 'function',
              function: {
                name,
                arguments: typeof args === 'string' ? args : JSON.stringify(args),
              },
            })
          }
        } catch { /* invalid JSON in XML block, skip */ }
      }
      if (calls.length > 0) return calls
    }

    return null
  }

  private buildConversationHistory(conversationId: number): Array<{ role: string; content: string }> {
    const rows = this.db
      .prepare('SELECT role, content FROM chatMessages WHERE conversationId = ? ORDER BY createdAt ASC')
      .all(conversationId) as Array<{ role: string; content: string }>

    let charCount = 0
    const history: Array<{ role: string; content: string }> = []
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i]
      if (!isChatRole(row.role)) continue
      if (charCount + row.content.length > MAX_HISTORY_CHARS) break
      history.unshift({ role: row.role, content: row.content })
      charCount += row.content.length
    }
    return history
  }

  private saveAssistantMessage(
    conversationId: number,
    content: string,
    metadata?: {
      responseUsage?: TokenUsage | null
      runUsage?: RunUsageSnapshot | null
      provider?: string | null
      model?: string | null
      effortLevel?: ChatEffortLevel | null
      usageCapturedAt?: string | null
    }
  ): ChatMessage {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(`
        INSERT INTO chatMessages (
          conversationId,
          role,
          content,
          createdAt,
          responseUsageJson,
          runUsageJson,
          provider,
          model,
          effortLevel,
          usageCapturedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        conversationId,
        'assistant',
        content,
        now,
        metadata?.responseUsage ? JSON.stringify(metadata.responseUsage) : null,
        metadata?.runUsage ? JSON.stringify(metadata.runUsage) : null,
        metadata?.provider ?? null,
        metadata?.model ?? null,
        metadata?.effortLevel ?? null,
        metadata?.usageCapturedAt ?? null,
      )

    this.db
      .prepare('UPDATE chatConversations SET updatedAt = ? WHERE id = ?')
      .run(now, conversationId)

    const row = this.db
      .prepare('SELECT * FROM chatMessages WHERE id = ?')
      .get(result.lastInsertRowid) as Record<string, unknown>
    return hydrateChatMessageRow(row)
  }

  private resolveProjectName(projectId: string | null): string {
    if (!projectId) return 'All Projects'
    return this.projectDAO.getById(projectId)?.name || 'Project'
  }

  private resolveProjectPath(projectId: string | null): string | null {
    if (!projectId) return null
    return this.projectDAO.getById(projectId)?.path || null
  }

  private buildSystemPrompt(
    projectName: string,
    planEnforcement: boolean,
    projectPath?: string | null,
    browserIntentDetected: boolean = false,
  ): string {
    const base = [
      `You are the Pinyino agent for "${projectName}".`,
    ]

    if (projectPath) {
      base.push(`The project directory is: ${projectPath}`)
      base.push('IMPORTANT: Always use this project path as the base for file operations (read_file, read_file_range, read_many_files, list_files, get_directory_tree, glob_files, grep_files, get_file_info, write_file, apply_file_patch, move_path, git_status, etc). Never assume or use a different directory.')
    }

    base.push('You can use tools to manage tasks, notes, sessions, git, files, semantic code discovery, web-project analysis, search, and browser actions.')
    base.push('Be concise and action-oriented.')

    // Tool routing preferences
    base.push('Tool selection guidance: prefer find_symbol over grep_files for definition lookup. Prefer find_references/find_importers over brute-force text search for usage questions. Prefer find_related_files over list_files for companion discovery. Use list_changed_files before broad exploration for review/refactor tasks. For route/design/env/component/deploy questions, prefer bridge tools (discover_routes, inspect_design_system, env_doctor, component_usage, launch_guard_summary, discover_previews) over raw file reads. For existing-file edits, prefer apply_file_patch over write_file. Use write_file mainly for new files or intentional full rewrites.')

    if (planEnforcement) {
      base.push('Do not call set_plan unless you are about to use browser tools.')
      base.push('For code reading, search, git, notes, tasks, and file work, skip set_plan and update_plan.')
      if (browserIntentDetected) {
        base.push('This request likely needs browser work. Call set_plan immediately before the first browser action, not earlier.')
      } else {
        base.push('If browser work becomes necessary later, call set_plan immediately before the first browser action.')
      }
      base.push('After each meaningful browser action, verify it with browser_dom_map, browser_get_element_info, browser_snapshot, or browser_console_logs, then call update_plan.')
    } else {
      base.push('Plan tools are browser-specific. Ignore them unless you are about to use browser tools.')
    }

    return base.join(' ')
  }

  private sendEvent(run: ActiveRun, channel: AgentEventChannel, payload: Record<string, unknown>): void {
    const wc = webContents.fromId(run.senderWebContentsId)
    if (!wc || wc.isDestroyed()) return
    wc.send(channel, {
      conversationId: run.conversationId,
      ...payload,
    })
  }

  /**
   * Ask the renderer for confirmation before executing a destructive browser action.
   * Returns true if the user confirms, false if denied or timed out.
   */
  private async requestConfirmation(
    run: ActiveRun,
    action: string,
    details: Record<string, unknown>
  ): Promise<boolean> {
    const wc = webContents.fromId(run.senderWebContentsId)
    if (!wc || wc.isDestroyed()) return false

    wc.send('agent:confirmAction', { runId: run.id, action, details })

    return new Promise<boolean>((resolve) => {
      let settled = false

      const timeout = setTimeout(() => {
        if (settled) return
        settled = true
        ipcMain.removeListener('agent:confirmResponse', handler)
        resolve(false)
      }, CONFIRMATION_TIMEOUT_MS)

      const handler = (_event: Electron.IpcMainEvent, payload: unknown) => {
        if (settled) return
        const data = payload as { runId?: string; confirmed?: boolean } | null
        if (!data || data.runId !== run.id) return

        settled = true
        clearTimeout(timeout)
        ipcMain.removeListener('agent:confirmResponse', handler)
        resolve(data.confirmed === true)
      }

      ipcMain.on('agent:confirmResponse', handler)
    })
  }

  private async executeToolCall(
    run: ActiveRun,
    name: string,
    args: Record<string, unknown>,
    context: {
      projectId: string | null
      projectPath: string | null
    }
  ): Promise<string> {
    // Plan tools: mutate run state directly
    if (name === 'set_plan') {
      return this.executeSetPlan(run, args)
    }
    if (name === 'update_plan') {
      return this.executeUpdatePlan(run, args)
    }

    if (this.isBrowserTool(name)) {
      run.browserIntentDetected = true
    }

    if (run.planEnforcement && this.isBrowserTool(name) && !run.plan?.length) {
      return JSON.stringify({
        error: 'NO_ACTIVE_PLAN. Call set_plan() before browser actions.',
      })
    }

    if (
      run.planEnforcement &&
      this.isBrowserTool(name) &&
      run.awaitingVerification &&
      !VERIFICATION_BROWSER_TOOLS.has(name)
    ) {
      return JSON.stringify({
        error: 'VERIFY_LAST_ACTION_FIRST. Call browser_dom_map, browser_get_element_info, browser_snapshot, or browser_console_logs, then update_plan before the next browser action.',
        lastBrowserAction: run.lastBrowserAction,
      })
    }

    // Domain security: validate URLs for navigation tools
    if (URL_BEARING_TOOLS.has(name)) {
      const url = asString(args.url)
      if (url) {
        const blocked = this.validateBrowserUrl(url)
        if (blocked) {
          return JSON.stringify({ error: `DOMAIN_BLOCKED. ${blocked}` })
        }
      }
    }

    // Browser reset: special Electron session handling
    if (name === 'browser_reset_session') {
      const ses = session.fromPartition('persist:browser')
      await ses.clearStorageData({
        storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
      })
      await ses.clearCache()
      return JSON.stringify({ success: true, message: 'Browser session cleared: cookies, localStorage, indexedDB, service workers, cache storage, and HTTP cache.' })
    }

    // Registry-managed tools (data, git, file, codebase)
    if (this.toolRegistry.has(name)) {
      return this.toolRegistry.execute(name, context, args)
    }

    // Browser tools: route through BrowserBridge
    if (this.isBrowserTool(name)) {
      // Check if destructive confirmation is required
      if (
        readConfig().browserConfirmDestructive &&
        DESTRUCTIVE_BROWSER_TOOLS.has(name)
      ) {
        const confirmed = await this.requestConfirmation(run, name, args)
        if (!confirmed) {
          return JSON.stringify({ error: 'ACTION_DENIED_BY_USER' })
        }
      }

      const result = await this.browserBridge.executeCommand({
        tool: name,
        args,
        projectId: context.projectId,
        timeoutMs: this.browserTimeoutForTool(name),
      })

      run.lastBrowserAction = name
      run.awaitingVerification =
        run.planEnforcement &&
        name !== 'browser_dom_map' &&
        name !== 'browser_get_element_info'
      this.emitPlanUpdate(run)

      return safeJsonStringify(result)
    }

    return JSON.stringify({ error: `Unknown tool: ${name}` })
  }

  private executeSetPlan(run: ActiveRun, args: Record<string, unknown>): string {
    if (!run.browserIntentDetected) {
      return JSON.stringify({
        error: 'PLAN_NOT_REQUIRED_YET. Only call set_plan immediately before browser actions. Skip it for code, git, notes, tasks, and file work.',
      })
    }

    const rawSteps = Array.isArray(args.steps) ? args.steps : []
    const steps = rawSteps
      .map((step) => {
        if (typeof step === 'string') return step.trim()
        if (typeof step === 'object' && step !== null && 'title' in step && typeof (step as { title?: unknown }).title === 'string') {
          return ((step as { title: string }).title || '').trim()
        }
        return ''
      })
      .filter(Boolean)
      .slice(0, 8)

    if (steps.length === 0) {
      return JSON.stringify({ error: 'steps must be a non-empty array' })
    }

    run.plan = steps.map((title) => ({ title, status: 'pending' }))
    run.planScope = 'browser'
    run.awaitingVerification = false
    run.lastBrowserAction = null

    this.emitPlanUpdate(run)

    return JSON.stringify({ success: true, plan: run.plan })
  }

  private executeUpdatePlan(run: ActiveRun, args: Record<string, unknown>): string {
    if (!run.plan?.length) {
      return JSON.stringify({ error: 'No active plan. Call set_plan first.' })
    }

    const stepIndex = numberOrUndefined(args.step_index) ?? numberOrUndefined(args.stepIndex)
    const status = asString(args.status)

    if (stepIndex === undefined || stepIndex < 0 || stepIndex >= run.plan.length) {
      return JSON.stringify({ error: 'step_index is out of range' })
    }
    if (status !== 'pending' && status !== 'done' && status !== 'blocked') {
      return JSON.stringify({ error: 'status must be pending, done, or blocked' })
    }

    run.plan[stepIndex].status = status
    run.awaitingVerification = false

    this.emitPlanUpdate(run)

    return JSON.stringify({ success: true, plan: run.plan })
  }

  private emitPlanUpdate(run: ActiveRun): void {
    this.sendEvent(run, 'agent:planUpdate', {
      runId: run.id,
      plan: run.plan ?? [],
      planScope: run.planScope,
      awaitingVerification: run.awaitingVerification,
      lastBrowserAction: run.lastBrowserAction,
    })
  }

  private detectBrowserIntent(input: string): boolean {
    const lowered = input.toLowerCase()
    const browserTerms = [
      'browser',
      'navigate',
      'navega',
      'navegue',
      'site',
      'pagina',
      'página',
      'screen',
      'screenshot',
      'print',
      'visual',
      'dom',
      'form',
      'formulario',
      'formulário',
      'login',
      'click',
      'clique',
      'ui',
      'ux',
      'teste',
      'test',
    ]
    return browserTerms.some((term) => lowered.includes(term))
  }

  private recordRunUsage(run: ActiveRun, usage: TokenUsage | null | undefined): void {
    const normalized = normalizeUsage(usage)
    if (!normalized) return

    run.usage.callCount += 1
    run.usage.lastCall = normalized
    run.usage.total = sumUsage(run.usage.total, normalized)
    run.usage.capturedAt = new Date().toISOString()

    const snapshot = this.buildRunUsageSnapshot(run)
    this.sendEvent(run, 'agent:usage', {
      runId: run.id,
      conversationId: run.conversationId,
      callCount: snapshot?.callCount ?? run.usage.callCount,
      lastCall: snapshot?.lastCall ?? normalized,
      total: snapshot?.total ?? run.usage.total,
      provider: run.provider,
      model: run.model,
      effortLevel: run.effortLevel,
      capturedAt: snapshot?.capturedAt ?? run.usage.capturedAt,
      source: snapshot?.source ?? normalized.source ?? 'provider',
    })
  }

  private buildRunUsageSnapshot(run: ActiveRun): RunUsageSnapshot | null {
    if (!run.usage.callCount || !run.usage.total) return null
    return {
      callCount: run.usage.callCount,
      lastCall: run.usage.lastCall,
      total: run.usage.total,
      provider: run.provider,
      model: run.model,
      effortLevel: run.effortLevel,
      capturedAt: run.usage.capturedAt,
      source: run.usage.total.source ?? 'provider',
    }
  }

  private isBrowserTool(name: string): boolean {
    return BROWSER_TOOL_NAMES.has(name)
  }

  /**
   * Validate a URL against domain allowlist/blocklist.
   * Delegates to the standalone validateBrowserUrl function.
   */
  private validateBrowserUrl(url: string): string | null {
    const config = readConfig()
    return validateBrowserUrl(url, DEFAULT_BLOCKED_DOMAINS, config.browserAllowedDomains)
  }

  private browserTimeoutForTool(name: string): number {
    if (name === 'browser_navigate') return 45_000
    if (name === 'browser_screenshot') return 20_000
    return 15_000
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) {
      const err = new Error('Agent run cancelled')
      err.name = 'AbortError'
      throw err
    }
  }
}

function normalizeAssistantContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((chunk) => {
      if (typeof chunk === 'string') return chunk
      if (typeof chunk === 'object' && chunk !== null && 'text' in chunk && typeof (chunk as { text?: unknown }).text === 'string') {
        return (chunk as { text: string }).text
      }
      return ''
    })
    .join('')
}

function normalizeUsage(usage: TokenUsage | null | undefined): TokenUsage | null {
  if (!usage) return null
  const prompt_tokens = typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : 0
  const completion_tokens = typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0
  const total_tokens = typeof usage.total_tokens === 'number'
    ? usage.total_tokens
    : prompt_tokens + completion_tokens
  const cache_read_tokens = typeof usage.cache_read_tokens === 'number' ? usage.cache_read_tokens : 0
  const cache_write_tokens = typeof usage.cache_write_tokens === 'number' ? usage.cache_write_tokens : 0
  const reasoning_tokens = typeof usage.reasoning_tokens === 'number' ? usage.reasoning_tokens : 0

  if (
    prompt_tokens === 0 &&
    completion_tokens === 0 &&
    total_tokens === 0 &&
    cache_read_tokens === 0 &&
    cache_write_tokens === 0 &&
    reasoning_tokens === 0
  ) {
    return null
  }

  return {
    prompt_tokens,
    completion_tokens,
    total_tokens,
    cache_read_tokens,
    cache_write_tokens,
    reasoning_tokens,
    source: usage.source ?? 'provider',
  }
}

function sumUsage(base: TokenUsage | null, extra: TokenUsage): TokenUsage {
  return {
    prompt_tokens: (base?.prompt_tokens ?? 0) + (extra.prompt_tokens ?? 0),
    completion_tokens: (base?.completion_tokens ?? 0) + (extra.completion_tokens ?? 0),
    total_tokens: (base?.total_tokens ?? 0) + (extra.total_tokens ?? 0),
    cache_read_tokens: (base?.cache_read_tokens ?? 0) + (extra.cache_read_tokens ?? 0),
    cache_write_tokens: (base?.cache_write_tokens ?? 0) + (extra.cache_write_tokens ?? 0),
    reasoning_tokens: (base?.reasoning_tokens ?? 0) + (extra.reasoning_tokens ?? 0),
    source: base?.source === extra.source ? (base?.source ?? 'provider') : extra.source ?? base?.source ?? 'provider',
  }
}

function parseUsageJson<T>(value: unknown): T | null {
  if (typeof value !== 'string' || value.length === 0) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

function hydrateChatMessageRow(row: Record<string, unknown>): ChatMessage {
  const hydrated = { ...row } as ChatMessage & Record<string, unknown>
  hydrated.responseUsage = parseUsageJson<TokenUsage>(row.responseUsageJson)
  hydrated.runUsage = parseUsageJson<RunUsageSnapshot>(row.runUsageJson)
  hydrated.provider = typeof row.provider === 'string' ? row.provider : null
  hydrated.model = typeof row.model === 'string' ? row.model : null
  hydrated.effortLevel = typeof row.effortLevel === 'string' ? row.effortLevel as ChatEffortLevel : null
  hydrated.usageCapturedAt = typeof row.usageCapturedAt === 'string' ? row.usageCapturedAt : null
  delete hydrated.responseUsageJson
  delete hydrated.runUsageJson
  return hydrated
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {}
  try {
    const parsed = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ value: String(value) })
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  return error instanceof Error && error.name === 'AbortError'
}

function isChatRole(role: string): role is 'system' | 'user' | 'assistant' {
  return role === 'system' || role === 'user' || role === 'assistant'
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
