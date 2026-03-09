/**
 * Git tools: status, log, diff, changed files.
 *
 * All operations delegate to the shared GitService instance and
 * require a valid projectPath in the execution context.
 */

import type { GitService } from '../../GitService'
import type { ToolDefinition, ToolExecutionContext } from '../ToolContracts'

// ---------------------------------------------------------------------------
// Arg-parsing helpers
// ---------------------------------------------------------------------------

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

function asGitChangedScope(v: unknown): 'working_tree' | 'staged' | 'branch_diff' | undefined {
  return v === 'working_tree' || v === 'staged' || v === 'branch_diff' ? v : undefined
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createGitTools(gitService: GitService): ToolDefinition[] {
  return [
    // ----- git_status -----
    {
      name: 'git_status',
      description: 'Get git status for the current project.',
      schema: {
        type: 'object',
        properties: {},
      },
      category: 'git',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        return JSON.stringify(await gitService.status(ctx.projectPath))
      },
    },

    // ----- git_log -----
    {
      name: 'git_log',
      description: 'Get recent git commits.',
      schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of commits to return.' },
        },
      },
      category: 'git',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        const log = await gitService.log(ctx.projectPath, {
          limit: numberOrUndefined(args.limit) ?? 10,
        })
        return JSON.stringify(log, null, 2)
      },
    },

    // ----- git_diff -----
    {
      name: 'git_diff',
      description: 'Get git diff for current project.',
      schema: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: 'Show staged changes only.' },
        },
      },
      category: 'git',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        const diff = await gitService.diff(ctx.projectPath, {
          staged: boolOrUndefined(args.staged),
        })
        return diff.slice(0, 8_000) || '(no changes)'
      },
    },

    // ----- list_changed_files -----
    {
      name: 'list_changed_files',
      description: 'List changed files in the current project by scope: working tree, staged, or branch diff.',
      schema: {
        type: 'object',
        properties: {
          scope: { type: 'string', enum: ['working_tree', 'staged', 'branch_diff'], description: 'Change scope.' },
          limit: { type: 'number', description: 'Maximum number of files to return.' },
        },
      },
      category: 'git',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        const scope = asGitChangedScope(args.scope) ?? 'working_tree'
        const files = await gitService.listChangedFiles(ctx.projectPath, {
          scope,
          limit: numberOrUndefined(args.limit) ?? 50,
        })
        return JSON.stringify(files, null, 2)
      },
    },
  ]
}
