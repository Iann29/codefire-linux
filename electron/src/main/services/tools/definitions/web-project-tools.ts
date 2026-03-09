/**
 * Web-project bridge tools: route discovery, design system, env doctor,
 * component usage, launch guard, preview discovery.
 *
 * Each tool wraps an existing analysis service through WebProjectToolService,
 * making them available as first-class agent tools.
 */

import type { WebProjectToolService } from '../codebase/WebProjectToolService'
import type { ToolDefinition, ToolExecutionContext } from '../ToolContracts'

// ---------------------------------------------------------------------------
// Arg-parsing helpers
// ---------------------------------------------------------------------------

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({ value: String(value) })
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createWebProjectTools(
  webProjectToolService: WebProjectToolService
): ToolDefinition[] {
  return [
    // ----- discover_routes -----
    {
      name: 'discover_routes',
      description: 'Discover the route topology of a web project. Returns framework, route list, route types, and source files. Prefer this over raw file exploration for route questions.',
      schema: {
        type: 'object',
        properties: {},
      },
      category: 'web-project',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, _args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        return safeJsonStringify(await webProjectToolService.discoverRoutes(ctx.projectPath))
      },
    },

    // ----- inspect_design_system -----
    {
      name: 'inspect_design_system',
      description: 'Inspect the design system: style stack, design tokens, token namespaces, and inconsistencies. Prefer this over grep for design/token questions.',
      schema: {
        type: 'object',
        properties: {},
      },
      category: 'web-project',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, _args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        return safeJsonStringify(await webProjectToolService.inspectDesignSystem(ctx.projectPath))
      },
    },

    // ----- env_doctor -----
    {
      name: 'env_doctor',
      description: 'Audit environment variable definitions vs code usage. Returns a health score, missing vars, suspicious exposures, and unused vars.',
      schema: {
        type: 'object',
        properties: {},
      },
      category: 'web-project',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, _args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        return safeJsonStringify(await webProjectToolService.envDoctor(ctx.projectPath))
      },
    },

    // ----- component_usage -----
    {
      name: 'component_usage',
      description: 'Inspect component graph: imports, render edges, entry points, and hotspots. Can filter by component name or file path.',
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Component name to inspect (e.g. "Button").' },
          path: { type: 'string', description: 'Project-relative file path to inspect.' },
        },
      },
      category: 'web-project',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        return safeJsonStringify(await webProjectToolService.componentUsage(ctx.projectPath, {
          name: asString(args.name),
          path: asString(args.path),
        }))
      },
    },

    // ----- launch_guard_summary -----
    {
      name: 'launch_guard_summary',
      description: 'Summarize deploy readiness: runs env doctor + route discovery + git checks and produces a scored launch report.',
      schema: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Current git branch name.' },
          isClean: { type: 'boolean', description: 'Whether the working tree is clean.' },
        },
      },
      category: 'web-project',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })

        const branch = asString(args.branch)
        const isClean = typeof args.isClean === 'boolean' ? args.isClean : undefined

        const gitStatus = branch !== undefined
          ? { branch, isClean: isClean ?? true, files: [] as Array<{ status: string; path: string }> }
          : undefined

        return safeJsonStringify(await webProjectToolService.launchGuardSummary(
          ctx.projectPath,
          gitStatus,
        ))
      },
    },

    // ----- discover_previews -----
    {
      name: 'discover_previews',
      description: 'Discover preview environments and infer the production URL for the project.',
      schema: {
        type: 'object',
        properties: {
          branch: { type: 'string', description: 'Current git branch name.' },
          isClean: { type: 'boolean', description: 'Whether the working tree is clean.' },
        },
      },
      category: 'web-project',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })

        const branch = asString(args.branch)
        const isClean = typeof args.isClean === 'boolean' ? args.isClean : undefined

        const gitInfo = branch !== undefined
          ? { branch, isClean: isClean ?? true }
          : undefined

        return safeJsonStringify(await webProjectToolService.discoverPreviews(
          ctx.projectPath,
          gitInfo,
        ))
      },
    },
  ]
}
