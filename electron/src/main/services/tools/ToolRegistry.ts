/**
 * Central registry for all agent tools.
 *
 * Manages tool definitions, exposes the provider schema list,
 * and routes execution by tool name.
 */

import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolCategory,
  ProviderToolSchema,
} from './ToolContracts'
import { toProviderSchema } from './ToolContracts'

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>()

  /** Register a single tool definition */
  register(def: ToolDefinition): void {
    if (this.tools.has(def.name)) {
      console.warn(`[ToolRegistry] Overwriting existing tool: ${def.name}`)
    }
    this.tools.set(def.name, def)
  }

  /** Register multiple tool definitions at once */
  registerAll(defs: ToolDefinition[]): void {
    for (const def of defs) {
      this.register(def)
    }
  }

  /** Check if a tool is registered */
  has(name: string): boolean {
    return this.tools.has(name)
  }

  /** Get a tool definition by name */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name)
  }

  /** Get all registered tool names */
  names(): string[] {
    return Array.from(this.tools.keys())
  }

  /** Get tool definitions filtered by category */
  byCategory(category: ToolCategory): ToolDefinition[] {
    return Array.from(this.tools.values()).filter((t) => t.category === category)
  }

  /** Get all tools as OpenAI-compatible provider schemas */
  toProviderSchemas(): ProviderToolSchema[] {
    return Array.from(this.tools.values()).map(toProviderSchema)
  }

  /**
   * Execute a tool by name.
   * Returns the JSON string result, or an error JSON if the tool is not found.
   */
  async execute(
    name: string,
    ctx: ToolExecutionContext,
    args: Record<string, unknown>
  ): Promise<string> {
    const def = this.tools.get(name)
    if (!def) {
      return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
    return def.execute(ctx, args)
  }

  /** Get the count of registered tools */
  get size(): number {
    return this.tools.size
  }
}
