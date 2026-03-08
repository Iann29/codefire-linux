import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { ipcMain, session, webContents } from 'electron'
import type { ChatMessage } from '@shared/models'
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

type AgentEventChannel =
  | 'agent:stream'
  | 'agent:toolStart'
  | 'agent:toolResult'
  | 'agent:planUpdate'
  | 'agent:compacted'
  | 'agent:done'
  | 'agent:error'

interface AgentPlanStep {
  title: string
  status: 'pending' | 'done' | 'blocked'
}

interface ActiveRun {
  id: string
  conversationId: number
  senderWebContentsId: number
  startedAt: string
  abortController: AbortController
  projectId: string | null
  plan: AgentPlanStep[] | null
  awaitingVerification: boolean
  lastBrowserAction: string | null
  planEnforcement: boolean
  contextCompaction: boolean
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
  planEnforcement?: boolean
  contextCompaction?: boolean
}

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6'
const MAX_HISTORY_CHARS = 25_000
const DEFAULT_MAX_ITERATIONS = 30
const MAX_MAX_ITERATIONS = 100
const RETRY_MAX_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 1000
const RETRY_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])

const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'set_plan',
      description: 'Define a concrete plan before browser actions. Use 3-8 actionable steps.',
      parameters: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                  },
                  required: ['title'],
                },
              ],
            },
          },
        },
        required: ['steps'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_plan',
      description: 'Update a plan step status after verifying the action result.',
      parameters: {
        type: 'object',
        properties: {
          step_index: { type: 'number' },
          status: { type: 'string', enum: ['pending', 'done', 'blocked'] },
        },
        required: ['step_index', 'status'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: 'List tasks for the current project or globally.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_task',
      description: 'Create a new task in the current project.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          description: { type: 'string' },
          priority: { type: 'number' },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['title'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_task',
      description: 'Update an existing task by ID.',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'number' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string' },
          priority: { type: 'number' },
          labels: { type: 'array', items: { type: 'string' } },
        },
        required: ['id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_code',
      description: 'Search code in the current project.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_notes',
      description: 'List notes for the current project.',
      parameters: {
        type: 'object',
        properties: {
          pinned_only: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_note',
      description: 'Create a new note in the current project.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          content: { type: 'string' },
          pinned: { type: 'boolean' },
        },
        required: ['title', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_notes',
      description: 'Search notes by keyword.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_sessions',
      description: 'List recent sessions for the project.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_sessions',
      description: 'Search sessions by keyword.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Get git status for the current project.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: 'Get recent git commits.',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Get git diff for current project.',
      parameters: {
        type: 'object',
        properties: {
          staged: { type: 'boolean' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_projects',
      description: 'List all CodeFire tracked projects.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_navigate',
      description: 'Navigate the browser to a URL.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_dom_map',
      description: 'Map interactive DOM elements and assign stable indices for browser automation.',
      parameters: {
        type: 'object',
        properties: {
          max_elements: { type: 'number' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_click_element',
      description: 'Click an element by DOM map index.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number' },
        },
        required: ['index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_type_element',
      description: 'Type text into an element by DOM map index.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          text: { type: 'string' },
          clearFirst: { type: 'boolean' },
          pressEnter: { type: 'boolean' },
        },
        required: ['index', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_select_element',
      description: 'Select an option in a <select> element by DOM map index.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          value: { type: 'string' },
        },
        required: ['index', 'value'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_hover_element',
      description: 'Move pointer over an element by DOM map index.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number' },
        },
        required: ['index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_scroll_to_element',
      description: 'Scroll an element into view by DOM map index.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          block: { type: 'string' },
        },
        required: ['index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_element_info',
      description: 'Get details for an indexed DOM element.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number' },
        },
        required: ['index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait_element',
      description: 'Wait for an element to reach a state: attached, detached, visible, or hidden.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector' },
          state: { type: 'string', enum: ['attached', 'detached', 'visible', 'hidden'] },
          timeout: { type: 'number', description: 'Timeout in ms (default 5000)' },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_wait_navigation',
      description: 'Wait for page navigation to complete.',
      parameters: {
        type: 'object',
        properties: {
          strategy: { type: 'string', enum: ['load', 'networkidle', 'urlchange'] },
          timeout: { type: 'number', description: 'Timeout in ms (default 10000)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_get_content',
      description: 'Get page content in different modes: text, html, url, title, links, or meta.',
      parameters: {
        type: 'object',
        properties: {
          mode: { type: 'string', enum: ['text', 'html', 'url', 'title', 'links', 'meta'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_press_key',
      description: 'Press a keyboard key with optional modifiers.',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key name: Enter, Tab, Escape, ArrowDown, a, etc.' },
          modifiers: { type: 'array', items: { type: 'string' }, description: 'Array of modifiers: Control, Shift, Alt, Meta' },
        },
        required: ['key'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_extract_table',
      description: 'Extract a table from the page as JSON with headers and rows.',
      parameters: {
        type: 'object',
        properties: {
          selector: { type: 'string', description: 'CSS selector for the table (default: "table")' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_nuclear_type',
      description: 'Type text into an element using nuclear interaction engine (robust for rich text editors like Draft.js, Lexical, ProseMirror, Slate, Quill, CKEditor, CodeMirror, Monaco). Tries multiple strategies with auto-detection and verification. Use when browser_type_element fails on complex editors.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'DOM map element index' },
          text: { type: 'string', description: 'Text to type' },
          clearFirst: { type: 'boolean', description: 'Clear existing content before typing (default true)' },
          pressEnter: { type: 'boolean', description: 'Press Enter after typing (default false)' },
          charDelay: { type: 'number', description: 'Delay between chars in ms for keyboard strategy (default 20)' },
          strategy: { type: 'string', enum: ['auto', 'keyboard', 'execCommand', 'inputEvent', 'clipboard', 'nativeSetter', 'direct'], description: 'Typing strategy (default auto)' },
        },
        required: ['index', 'text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_nuclear_click',
      description: 'Click an element using nuclear interaction engine (robust for overlays, React portals, synthetic event listeners). Tries 4 strategies: pointer chain, native click, elementFromPoint, interactive ancestor. Use when browser_click_element fails on complex UIs.',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'number', description: 'DOM map element index' },
        },
        required: ['index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_fill_form',
      description: 'Fill multiple form fields at once. Each field is identified by DOM map index.',
      parameters: {
        type: 'object',
        properties: {
          fields: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                index: { type: 'number', description: 'DOM map element index' },
                value: { type: 'string', description: 'Value to set' },
              },
              required: ['index', 'value'],
            },
            description: 'Array of { index, value } pairs',
          },
        },
        required: ['fields'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_drag_and_drop',
      description: 'Drag an element to another element by DOM map indices.',
      parameters: {
        type: 'object',
        properties: {
          sourceIndex: { type: 'number', description: 'DOM map index of source element' },
          targetIndex: { type: 'number', description: 'DOM map index of target element' },
        },
        required: ['sourceIndex', 'targetIndex'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_list_tabs',
      description: 'List all open browser tabs with their URL, title, and active status.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_open_tab',
      description: 'Open a new browser tab with a URL. Limited to 5 tabs per session.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL to open in the new tab' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_close_tab',
      description: 'Close a browser tab by its tab ID.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', description: 'Tab ID to close (from browser_list_tabs)' },
        },
        required: ['tabId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_switch_tab',
      description: 'Switch to a browser tab by its tab ID.',
      parameters: {
        type: 'object',
        properties: {
          tabId: { type: 'string', description: 'Tab ID to activate (from browser_list_tabs)' },
        },
        required: ['tabId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'browser_reset_session',
      description: 'Clear all browser cookies, cache, localStorage, and session data. Use before testing login, onboarding, or stateful flows.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file from disk.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories in a path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
        },
        required: ['path'],
      },
    },
  },
] as const

const BROWSER_TOOL_NAMES = new Set<string>([
  'browser_navigate',
  'browser_snapshot',
  'browser_screenshot',
  'browser_click',
  'browser_type',
  'browser_eval',
  'browser_console_logs',
  'browser_dom_map',
  'browser_click_element',
  'browser_type_element',
  'browser_select_element',
  'browser_hover_element',
  'browser_scroll_to_element',
  'browser_get_element_info',
  'browser_wait_element',
  'browser_wait_navigation',
  'browser_get_content',
  'browser_press_key',
  'browser_extract_table',
  'browser_nuclear_type',
  'browser_nuclear_click',
  'browser_list_tabs',
  'browser_open_tab',
  'browser_close_tab',
  'browser_switch_tab',
  'browser_fill_form',
  'browser_drag_and_drop',
  'browser_reset_session',
])

const VERIFICATION_BROWSER_TOOLS = new Set<string>([
  'browser_dom_map',
  'browser_get_element_info',
  'browser_snapshot',
  'browser_console_logs',
])

/** Tools that accept a URL argument and should be validated against domain rules. */
export const URL_BEARING_TOOLS = new Set<string>(['browser_navigate', 'browser_open_tab'])

/** Browser tools that can modify page state and may require user confirmation. */
export const DESTRUCTIVE_BROWSER_TOOLS = new Set<string>([
  'browser_nuclear_click',
  'browser_nuclear_type',
  'browser_fill_form',
  'browser_drag_and_drop',
])

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
  private providerRouter: ProviderRouter
  private readonly contextCompactor = new ContextCompactor()
  private readonly metrics = new AgentMetrics()
  private activeRun: ActiveRun | null = null

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
  }

  setProviderRouter(router: ProviderRouter): void {
    this.providerRouter = router
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
      awaitingVerification: false,
      lastBrowserAction: null,
      planEnforcement: true,
      contextCompaction: false,
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

      const history = this.buildConversationHistory(run.conversationId)
      let loopMessages: Array<Record<string, unknown>> = [
        { role: 'system', content: this.buildSystemPrompt(projectName, run.planEnforcement, projectPath) },
        ...history,
      ]

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        this.throwIfAborted(run.abortController.signal)

        // Enhanced system prompt: inject current browser URL context per iteration
        const browserContext = await this.getBrowserContext()
        if (browserContext) {
          loopMessages[0] = {
            role: 'system',
            content: this.buildSystemPrompt(projectName, run.planEnforcement, projectPath) + '\n\n' + browserContext,
          }
        }

        const response = await this.chatCompletionWithRetry(config, {
          model,
          temperature,
          messages: loopMessages,
          tools: AGENT_TOOLS,
          signal: run.abortController.signal,
        }, providerOverrides)

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
          this.sendEvent(run, 'agent:stream', {
            runId: run.id,
            channel: 'text',
            delta: finalContent,
          })

          const savedMessage = this.saveAssistantMessage(run.conversationId, finalContent)
          this.sendEvent(run, 'agent:done', {
            runId: run.id,
            cancelled: false,
            message: savedMessage,
            usage: response.usage ?? null,
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
          this.metrics.recordToolCall(fnName, durationMs, status === 'error' ? 'error' : 'done')

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
              signal: run.abortController.signal,
            }, providerOverrides)

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
      this.sendEvent(run, 'agent:stream', {
        runId: run.id,
        channel: 'text',
        delta: fallback,
      })
      const savedMessage = this.saveAssistantMessage(run.conversationId, fallback)
      this.sendEvent(run, 'agent:done', {
        runId: run.id,
        cancelled: false,
        message: savedMessage,
        usage: null,
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

  private saveAssistantMessage(conversationId: number, content: string): ChatMessage {
    const now = new Date().toISOString()
    const result = this.db
      .prepare('INSERT INTO chatMessages (conversationId, role, content, createdAt) VALUES (?, ?, ?, ?)')
      .run(conversationId, 'assistant', content, now)

    this.db
      .prepare('UPDATE chatConversations SET updatedAt = ? WHERE id = ?')
      .run(now, conversationId)

    return this.db
      .prepare('SELECT * FROM chatMessages WHERE id = ?')
      .get(result.lastInsertRowid) as ChatMessage
  }

  private resolveProjectName(projectId: string | null): string {
    if (!projectId) return 'All Projects'
    return this.projectDAO.getById(projectId)?.name || 'Project'
  }

  private resolveProjectPath(projectId: string | null): string | null {
    if (!projectId) return null
    return this.projectDAO.getById(projectId)?.path || null
  }

  private buildSystemPrompt(projectName: string, planEnforcement: boolean, projectPath?: string | null): string {
    const base = [
      `You are the CodeFire agent for "${projectName}".`,
    ]

    if (projectPath) {
      base.push(`The project directory is: ${projectPath}`)
      base.push('IMPORTANT: Always use this project path as the base for file operations (read_file, list_files, git_status, etc). Never assume or use a different directory.')
    }

    base.push('You can use tools to manage tasks, notes, sessions, git, files, search, and browser actions.')
    base.push('Be concise and action-oriented.')

    if (planEnforcement) {
      base.push('Before using browser tools, call set_plan with 3-8 concrete steps.')
      base.push('After each meaningful browser action, verify and then call update_plan.')
    } else {
      base.push('Plan tools are optional in this run; use them when useful.')
    }

    return base.join(' ')
  }

  private sendEvent(run: ActiveRun, channel: AgentEventChannel, payload: Record<string, unknown>): void {
    const wc = webContents.fromId(run.senderWebContentsId)
    if (!wc || wc.isDestroyed()) return
    wc.send(channel, payload)
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
    if (name === 'set_plan') {
      return this.executeSetPlan(run, args)
    }
    if (name === 'update_plan') {
      return this.executeUpdatePlan(run, args)
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
        error: 'VERIFY_LAST_ACTION_FIRST. Call browser_dom_map or browser_get_element_info, then update_plan before the next browser action.',
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

    switch (name) {
      case 'list_tasks': {
        const tasks = context.projectId
          ? this.taskDAO.list(context.projectId, stringOrUndefined(args.status))
          : this.taskDAO.listGlobal(stringOrUndefined(args.status))

        return JSON.stringify(
          tasks.slice(0, 30).map((task) => ({
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
            labels: task.labels,
            description: task.description?.slice(0, 200),
          })),
          null,
          2
        )
      }

      case 'create_task': {
        const title = asString(args.title)
        if (!title) return JSON.stringify({ error: 'title is required' })

        const task = this.taskDAO.create({
          projectId: context.projectId || '__global__',
          title,
          description: stringOrUndefined(args.description),
          priority: numberOrUndefined(args.priority),
          labels: stringArrayOrUndefined(args.labels),
          isGlobal: !context.projectId,
        })
        return JSON.stringify({ success: true, id: task.id, title: task.title })
      }

      case 'update_task': {
        const id = numberOrUndefined(args.id)
        if (id === undefined) return JSON.stringify({ error: 'id is required' })

        const updates = {
          title: stringOrUndefined(args.title),
          description: stringOrUndefined(args.description),
          status: stringOrUndefined(args.status),
          priority: numberOrUndefined(args.priority),
          labels: stringArrayOrUndefined(args.labels),
        }
        const task = this.taskDAO.update(id, updates)
        return task
          ? JSON.stringify({ success: true, id: task.id, title: task.title, status: task.status })
          : JSON.stringify({ error: 'Task not found' })
      }

      case 'search_code': {
        if (!context.projectId) return JSON.stringify({ error: 'No project selected' })
        if (!this.searchEngine) return JSON.stringify({ error: 'Search engine not ready yet' })
        const query = asString(args.query)
        if (!query) return JSON.stringify({ error: 'query is required' })

        const results = await this.searchEngine.search(context.projectId, query, {
          limit: numberOrUndefined(args.limit) ?? 5,
        })
        return JSON.stringify(
          results.map((result) => ({
            file: result.filePath,
            symbol: result.symbolName,
            type: result.chunkType,
            lines: result.startLine && result.endLine ? `${result.startLine}-${result.endLine}` : null,
            content: result.content.slice(0, 500),
            score: result.score.toFixed(3),
          })),
          null,
          2
        )
      }

      case 'list_notes': {
        if (!context.projectId) return JSON.stringify({ error: 'No project selected' })
        const notes = this.noteDAO.list(context.projectId, boolOrUndefined(args.pinned_only))
        return JSON.stringify(
          notes.slice(0, 20).map((note) => ({
            id: note.id,
            title: note.title,
            pinned: note.pinned,
            content: note.content.slice(0, 300),
            updatedAt: note.updatedAt,
          })),
          null,
          2
        )
      }

      case 'create_note': {
        const title = asString(args.title)
        const content = asString(args.content)
        if (!title || !content) return JSON.stringify({ error: 'title and content are required' })

        const note = this.noteDAO.create({
          projectId: context.projectId || '__global__',
          title,
          content,
          pinned: boolOrUndefined(args.pinned),
          isGlobal: !context.projectId,
        })
        return JSON.stringify({ success: true, id: note.id, title: note.title })
      }

      case 'search_notes': {
        if (!context.projectId) return JSON.stringify({ error: 'No project selected' })
        const query = asString(args.query)
        if (!query) return JSON.stringify({ error: 'query is required' })
        const notes = this.noteDAO.searchFTS(context.projectId, query)
        return JSON.stringify(
          notes.slice(0, 10).map((note) => ({
            id: note.id,
            title: note.title,
            content: note.content.slice(0, 300),
          })),
          null,
          2
        )
      }

      case 'list_sessions': {
        if (!context.projectId) return JSON.stringify({ error: 'No project selected' })
        const sessions = this.sessionDAO.list(context.projectId)
        return JSON.stringify(
          sessions.slice(0, 15).map((session) => ({
            id: session.id,
            summary: session.summary?.slice(0, 200),
            startedAt: session.startedAt,
            model: session.model,
            messageCount: session.messageCount,
          })),
          null,
          2
        )
      }

      case 'search_sessions': {
        const query = asString(args.query)
        if (!query) return JSON.stringify({ error: 'query is required' })
        const sessions = this.sessionDAO.searchFTS(query)
        return JSON.stringify(
          sessions.slice(0, 10).map((session) => ({
            id: session.id,
            summary: session.summary?.slice(0, 200),
            startedAt: session.startedAt,
            model: session.model,
          })),
          null,
          2
        )
      }

      case 'git_status': {
        if (!context.projectPath) return JSON.stringify({ error: 'No project path' })
        return JSON.stringify(await this.gitService.status(context.projectPath))
      }

      case 'git_log': {
        if (!context.projectPath) return JSON.stringify({ error: 'No project path' })
        const log = await this.gitService.log(context.projectPath, {
          limit: numberOrUndefined(args.limit) ?? 10,
        })
        return JSON.stringify(log, null, 2)
      }

      case 'git_diff': {
        if (!context.projectPath) return JSON.stringify({ error: 'No project path' })
        const diff = await this.gitService.diff(context.projectPath, {
          staged: boolOrUndefined(args.staged),
        })
        return diff.slice(0, 8_000) || '(no changes)'
      }

      case 'list_projects': {
        const projects = this.projectDAO.list()
        return JSON.stringify(
          projects.map((project) => ({
            id: project.id,
            name: project.name,
            path: project.path,
            lastOpened: project.lastOpened,
          })),
          null,
          2
        )
      }

      case 'read_file': {
        const filePath = asString(args.path)
        if (!filePath) return JSON.stringify({ error: 'path is required' })
        const content = await fs.readFile(filePath, 'utf-8')
        return content.slice(0, 8_000)
      }

      case 'browser_reset_session': {
        const ses = session.fromPartition('persist:browser')
        await ses.clearStorageData({
          storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'],
        })
        await ses.clearCache()
        return JSON.stringify({ success: true, message: 'Browser session cleared: cookies, localStorage, indexedDB, service workers, cache storage, and HTTP cache.' })
      }

      case 'list_files': {
        const dirPath = asString(args.path)
        if (!dirPath) return JSON.stringify({ error: 'path is required' })

        const entries = await fs.readdir(dirPath, { withFileTypes: true })
        const mapped = await Promise.all(entries.slice(0, 500).map(async (entry) => {
          const fullPath = path.join(dirPath, entry.name)
          let size: number | undefined
          if (entry.isFile()) {
            try {
              size = (await fs.stat(fullPath)).size
            } catch {
              size = undefined
            }
          }
          return {
            name: entry.name,
            path: fullPath,
            isDirectory: entry.isDirectory(),
            size,
          }
        }))
        return JSON.stringify(mapped, null, 2)
      }

      default: {
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
    }
  }

  private executeSetPlan(run: ActiveRun, args: Record<string, unknown>): string {
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
      awaitingVerification: run.awaitingVerification,
      lastBrowserAction: run.lastBrowserAction,
    })
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

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberOrUndefined(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function boolOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function stringArrayOrUndefined(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((item): item is string => typeof item === 'string')
  return strings.length > 0 ? strings : undefined
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
