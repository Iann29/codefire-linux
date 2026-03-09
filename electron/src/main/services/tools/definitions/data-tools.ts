/**
 * Data tools: tasks, notes, sessions, projects.
 *
 * These tools provide CRUD and search operations against the local
 * SQLite database through the corresponding DAO objects.
 */

import type { TaskDAO } from '@main/database/dao/TaskDAO'
import type { NoteDAO } from '@main/database/dao/NoteDAO'
import type { SessionDAO } from '@main/database/dao/SessionDAO'
import type { ProjectDAO } from '@main/database/dao/ProjectDAO'
import type { ToolDefinition, ToolExecutionContext } from '../ToolContracts'

// ---------------------------------------------------------------------------
// Arg-parsing helpers (local copies — no imports from AgentService)
// ---------------------------------------------------------------------------

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

function stringOrUndefined(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function numberOrUndefined(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const p = Number(v)
    if (Number.isFinite(p)) return p
  }
  return undefined
}

function boolOrUndefined(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined
}

function stringArrayOrUndefined(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const s = v.filter((i): i is string => typeof i === 'string')
  return s.length > 0 ? s : undefined
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createDataTools(deps: {
  taskDAO: TaskDAO
  noteDAO: NoteDAO
  sessionDAO: SessionDAO
  projectDAO: ProjectDAO
}): ToolDefinition[] {
  const { taskDAO, noteDAO, sessionDAO, projectDAO } = deps

  return [
    // ----- list_tasks -----
    {
      name: 'list_tasks',
      description: 'List tasks for the current project or globally.',
      schema: {
        type: 'object',
        properties: {
          status: { type: 'string', description: 'Filter tasks by status.' },
        },
      },
      category: 'task',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        const tasks = ctx.projectId
          ? taskDAO.list(ctx.projectId, stringOrUndefined(args.status))
          : taskDAO.listGlobal(stringOrUndefined(args.status))

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
          2,
        )
      },
    },

    // ----- create_task -----
    {
      name: 'create_task',
      description: 'Create a new task in the current project.',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Task title.' },
          description: { type: 'string', description: 'Task description.' },
          priority: { type: 'number', description: 'Task priority.' },
          labels: { type: 'array', items: { type: 'string' }, description: 'Task labels.' },
        },
        required: ['title'],
      },
      category: 'task',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        const title = asString(args.title)
        if (!title) return JSON.stringify({ error: 'title is required' })

        const task = taskDAO.create({
          projectId: ctx.projectId || '__global__',
          title,
          description: stringOrUndefined(args.description),
          priority: numberOrUndefined(args.priority),
          labels: stringArrayOrUndefined(args.labels),
          isGlobal: !ctx.projectId,
        })
        return JSON.stringify({ success: true, id: task.id, title: task.title })
      },
    },

    // ----- update_task -----
    {
      name: 'update_task',
      description: 'Update an existing task by ID.',
      schema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'Task ID.' },
          title: { type: 'string', description: 'New title.' },
          description: { type: 'string', description: 'New description.' },
          status: { type: 'string', description: 'New status.' },
          priority: { type: 'number', description: 'New priority.' },
          labels: { type: 'array', items: { type: 'string' }, description: 'New labels.' },
        },
        required: ['id'],
      },
      category: 'task',
      safetyLevel: 'safe',
      execute: async (_ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        const id = numberOrUndefined(args.id)
        if (id === undefined) return JSON.stringify({ error: 'id is required' })

        const updates = {
          title: stringOrUndefined(args.title),
          description: stringOrUndefined(args.description),
          status: stringOrUndefined(args.status),
          priority: numberOrUndefined(args.priority),
          labels: stringArrayOrUndefined(args.labels),
        }
        const task = taskDAO.update(id, updates)
        return task
          ? JSON.stringify({ success: true, id: task.id, title: task.title, status: task.status })
          : JSON.stringify({ error: 'Task not found' })
      },
    },

    // ----- list_notes -----
    {
      name: 'list_notes',
      description: 'List notes for the current project.',
      schema: {
        type: 'object',
        properties: {
          pinned_only: { type: 'boolean', description: 'Only show pinned notes.' },
        },
      },
      category: 'note',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectId) return JSON.stringify({ error: 'No project selected' })

        const notes = noteDAO.list(ctx.projectId, boolOrUndefined(args.pinned_only))
        return JSON.stringify(
          notes.slice(0, 20).map((note) => ({
            id: note.id,
            title: note.title,
            pinned: note.pinned,
            content: note.content.slice(0, 300),
            updatedAt: note.updatedAt,
          })),
          null,
          2,
        )
      },
    },

    // ----- create_note -----
    {
      name: 'create_note',
      description: 'Create a new note in the current project.',
      schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Note title.' },
          content: { type: 'string', description: 'Note content.' },
          pinned: { type: 'boolean', description: 'Pin the note.' },
        },
        required: ['title', 'content'],
      },
      category: 'note',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        const title = asString(args.title)
        const content = asString(args.content)
        if (!title || !content) return JSON.stringify({ error: 'title and content are required' })

        const note = noteDAO.create({
          projectId: ctx.projectId || '__global__',
          title,
          content,
          pinned: boolOrUndefined(args.pinned),
          isGlobal: !ctx.projectId,
        })
        return JSON.stringify({ success: true, id: note.id, title: note.title })
      },
    },

    // ----- search_notes -----
    {
      name: 'search_notes',
      description: 'Search notes by keyword.',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
        },
        required: ['query'],
      },
      category: 'note',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectId) return JSON.stringify({ error: 'No project selected' })

        const query = asString(args.query)
        if (!query) return JSON.stringify({ error: 'query is required' })

        const notes = noteDAO.searchFTS(ctx.projectId, query)
        return JSON.stringify(
          notes.slice(0, 10).map((note) => ({
            id: note.id,
            title: note.title,
            content: note.content.slice(0, 300),
          })),
          null,
          2,
        )
      },
    },

    // ----- list_sessions -----
    {
      name: 'list_sessions',
      description: 'List recent sessions for the project.',
      schema: {
        type: 'object',
        properties: {},
      },
      category: 'session',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext): Promise<string> => {
        if (!ctx.projectId) return JSON.stringify({ error: 'No project selected' })

        const sessions = sessionDAO.list(ctx.projectId)
        return JSON.stringify(
          sessions.slice(0, 15).map((session) => ({
            id: session.id,
            summary: session.summary?.slice(0, 200),
            startedAt: session.startedAt,
            model: session.model,
            messageCount: session.messageCount,
          })),
          null,
          2,
        )
      },
    },

    // ----- search_sessions -----
    {
      name: 'search_sessions',
      description: 'Search sessions by keyword.',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
        },
        required: ['query'],
      },
      category: 'session',
      safetyLevel: 'safe',
      execute: async (_ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        const query = asString(args.query)
        if (!query) return JSON.stringify({ error: 'query is required' })

        const sessions = sessionDAO.searchFTS(query)
        return JSON.stringify(
          sessions.slice(0, 10).map((session) => ({
            id: session.id,
            summary: session.summary?.slice(0, 200),
            startedAt: session.startedAt,
            model: session.model,
          })),
          null,
          2,
        )
      },
    },

    // ----- list_projects -----
    {
      name: 'list_projects',
      description: 'List all Pinyino tracked projects.',
      schema: {
        type: 'object',
        properties: {},
      },
      category: 'project',
      safetyLevel: 'safe',
      execute: async (): Promise<string> => {
        const projects = projectDAO.list()
        return JSON.stringify(
          projects.map((project) => ({
            id: project.id,
            name: project.name,
            path: project.path,
            lastOpened: project.lastOpened,
          })),
          null,
          2,
        )
      },
    },
  ]
}
