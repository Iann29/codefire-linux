import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { webContents } from 'electron'
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

type AgentEventChannel =
  | 'agent:stream'
  | 'agent:toolStart'
  | 'agent:toolResult'
  | 'agent:planUpdate'
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

const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-20250514'
const MAX_HISTORY_CHARS = 25_000
const DEFAULT_MAX_ITERATIONS = 10
const MAX_MAX_ITERATIONS = 30

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
])

const VERIFICATION_BROWSER_TOOLS = new Set<string>([
  'browser_dom_map',
  'browser_get_element_info',
  'browser_snapshot',
  'browser_console_logs',
])

export class AgentService {
  private readonly taskDAO: TaskDAO
  private readonly noteDAO: NoteDAO
  private readonly sessionDAO: SessionDAO
  private readonly projectDAO: ProjectDAO
  private readonly providerRouter: ProviderRouter
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
    if (!this.activeRun) return { status: 'idle' }
    return {
      status: 'running',
      runId: this.activeRun.id,
      conversationId: this.activeRun.conversationId,
      startedAt: this.activeRun.startedAt,
    }
  }

  private async executeRun(run: ActiveRun, input: AgentStartInput): Promise<void> {
    try {
      const config = readConfig()
      const provider = this.providerRouter.resolveProvider(config, { apiKey: input.apiKey })

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

      const systemPrompt = this.buildSystemPrompt(projectName, run.planEnforcement)
      const history = this.buildConversationHistory(run.conversationId)
      let loopMessages: Array<Record<string, unknown>> = [
        { role: 'system', content: systemPrompt },
        ...history,
      ]

      for (let iteration = 0; iteration < maxIterations; iteration++) {
        this.throwIfAborted(run.abortController.signal)

        const response = await provider.chatCompletion({
          model,
          temperature,
          messages: loopMessages,
          tools: AGENT_TOOLS,
          signal: run.abortController.signal,
        })

        const message = response.choices?.[0]?.message
        if (!message) throw new Error('No response from model')

        const toolCalls: ToolCall[] = Array.isArray(message.tool_calls) ? message.tool_calls : []
        const assistantContent = normalizeAssistantContent(message.content)

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
      }

      const fallback = 'I reached the maximum number of tool calls. Please refine your request.'
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
      if (this.activeRun?.id === run.id) {
        this.activeRun = null
      }
    }
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

  private buildSystemPrompt(projectName: string, planEnforcement: boolean): string {
    const base = [
      `You are the CodeFire agent for "${projectName}".`,
      'You can use tools to manage tasks, notes, sessions, git, files, search, and browser actions.',
      'Be concise and action-oriented.',
    ]

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
