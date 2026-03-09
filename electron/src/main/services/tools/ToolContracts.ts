/**
 * Tool contract definitions for the agent tool runtime.
 *
 * Each tool is represented by a ToolDefinition that includes its schema,
 * metadata, and execution function. The registry uses these contracts
 * to expose tools to providers and route execution.
 */

export type ToolSafetyLevel = 'safe' | 'cautious' | 'destructive'

export type ToolCategory =
  | 'plan'
  | 'task'
  | 'note'
  | 'session'
  | 'git'
  | 'project'
  | 'file-read'
  | 'file-write'
  | 'file-nav'
  | 'file-search'
  | 'codebase'
  | 'browser'
  | 'web-project'

export interface ToolParameterProperty {
  type: string
  description: string
  enum?: string[]
  items?: Record<string, unknown>
  default?: unknown
}

export interface ToolSchema {
  type: 'object'
  properties: Record<string, ToolParameterProperty>
  required?: string[]
}

export interface ToolResult {
  ok: boolean
  data?: unknown
  error?: string
  meta?: Record<string, unknown>
  hints?: {
    suggestedNextTools?: string[]
  }
}

export interface ToolExecutionContext {
  projectId: string | null
  projectPath: string | null
}

export interface ToolDefinition {
  name: string
  description: string
  schema: ToolSchema
  category: ToolCategory
  safetyLevel: ToolSafetyLevel
  execute: (ctx: ToolExecutionContext, args: Record<string, unknown>) => Promise<string>
}

/** OpenAI-compatible tool format for provider APIs */
export interface ProviderToolSchema {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: ToolSchema
  }
}

/** Convert a ToolDefinition to the OpenAI-compatible format */
export function toProviderSchema(def: ToolDefinition): ProviderToolSchema {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.schema,
    },
  }
}
