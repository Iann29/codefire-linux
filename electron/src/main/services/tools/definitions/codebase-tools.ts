/**
 * Codebase tools: semantic search, symbol lookup, related-file discovery,
 * reference graph queries, and companion-file discovery.
 *
 * search_code uses the SearchEngine (TF-IDF index); find_symbol and
 * find_related_files delegate to CodebaseToolService (chunk-based).
 * Graph-backed tools (find_references, find_importers, find_exports,
 * find_test_companions, find_style_companions) delegate to ReferenceGraphService.
 */

import type { CodebaseToolService } from '../codebase/CodebaseToolService'
import type { ReferenceGraphService } from '../codebase/ReferenceGraphService'
import type { SearchEngine } from '../../SearchEngine'
import type { ToolDefinition, ToolExecutionContext } from '../ToolContracts'

// ---------------------------------------------------------------------------
// Arg-parsing helpers
// ---------------------------------------------------------------------------

function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

function numberOrUndefined(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim()) {
    const p = Number(v)
    if (Number.isFinite(p)) return p
  }
  return undefined
}

function stringArrayOrUndefined(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const s = v.filter((i): i is string => typeof i === 'string')
  return s.length > 0 ? s : undefined
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

export function createCodebaseTools(deps: {
  codebaseToolService: CodebaseToolService
  searchEngine?: SearchEngine
  referenceGraph?: ReferenceGraphService
}): ToolDefinition[] {
  const { codebaseToolService, searchEngine, referenceGraph } = deps

  return [
    // ----- search_code -----
    {
      name: 'search_code',
      description: 'Search code in the current project.',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query.' },
          limit: { type: 'number', description: 'Maximum number of results.' },
        },
        required: ['query'],
      },
      category: 'codebase',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectId) return JSON.stringify({ error: 'No project selected' })
        if (!searchEngine) return JSON.stringify({ error: 'Search engine not ready yet' })

        const query = asString(args.query)
        if (!query) return JSON.stringify({ error: 'query is required' })

        const results = await searchEngine.search(ctx.projectId, query, {
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
          2,
        )
      },
    },

    // ----- find_symbol -----
    {
      name: 'find_symbol',
      description: 'Find likely symbol definitions in the indexed codebase by symbol name.',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Symbol name or partial symbol name to find.' },
          types: { type: 'array', items: { type: 'string' }, description: 'Optional chunk types to filter, e.g. ["function", "class"].' },
          limit: { type: 'number', description: 'Maximum number of symbol matches to return.' },
        },
        required: ['query'],
      },
      category: 'codebase',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await codebaseToolService.findSymbol({
          projectId: ctx.projectId,
          query: asString(args.query),
          types: stringArrayOrUndefined(args.types),
          limit: numberOrUndefined(args.limit),
        }))
      },
    },

    // ----- find_related_files -----
    {
      name: 'find_related_files',
      description: 'Find files related to a path, symbol, or query using indexed paths and code references.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative path to use as the primary seed.' },
          symbol: { type: 'string', description: 'Symbol name to use as the primary seed.' },
          query: { type: 'string', description: 'Fallback keyword or concept to use when path/symbol is not enough.' },
          limit: { type: 'number', description: 'Maximum number of related files to return.' },
        },
      },
      category: 'codebase',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await codebaseToolService.findRelatedFiles({
          projectId: ctx.projectId,
          projectPath: ctx.projectPath,
          path: asString(args.path),
          symbol: asString(args.symbol),
          query: asString(args.query),
          limit: numberOrUndefined(args.limit),
        }))
      },
    },

    // ----- find_references (graph-backed) -----
    {
      name: 'find_references',
      description: 'Find places where a symbol is imported, re-exported, or used. Prefer this over grep_files for usage questions.',
      schema: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Symbol name to find references for.' },
          path: { type: 'string', description: 'Project-relative path to narrow the search.' },
          limit: { type: 'number', description: 'Maximum number of references to return.' },
        },
        required: ['symbol'],
      },
      category: 'codebase',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        if (!referenceGraph) return JSON.stringify({ error: 'Reference graph service not available' })

        const symbol = asString(args.symbol)
        if (!symbol) return JSON.stringify({ error: 'symbol is required' })

        const results = await referenceGraph.findReferences(ctx.projectPath, {
          symbol,
          path: asString(args.path),
          limit: numberOrUndefined(args.limit),
        })
        return JSON.stringify({ ok: true, data: results }, null, 2)
      },
    },

    // ----- find_importers (graph-backed) -----
    {
      name: 'find_importers',
      description: 'Given a file or symbol, return upstream files that import or depend on it.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative path of the file to find importers for.' },
          symbol: { type: 'string', description: 'Symbol name to find importers for.' },
          limit: { type: 'number', description: 'Maximum number of importers to return.' },
        },
      },
      category: 'codebase',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        if (!referenceGraph) return JSON.stringify({ error: 'Reference graph service not available' })

        const results = await referenceGraph.findImporters(ctx.projectPath, {
          path: asString(args.path),
          symbol: asString(args.symbol),
          limit: numberOrUndefined(args.limit),
        })
        return JSON.stringify({ ok: true, data: results }, null, 2)
      },
    },

    // ----- find_exports (graph-backed) -----
    {
      name: 'find_exports',
      description: 'Return all exported symbols from a file, with export kind and line number.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative path of the file.' },
        },
        required: ['path'],
      },
      category: 'codebase',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        if (!referenceGraph) return JSON.stringify({ error: 'Reference graph service not available' })

        const filePath = asString(args.path)
        if (!filePath) return JSON.stringify({ error: 'path is required' })

        const results = await referenceGraph.findExports(ctx.projectPath, { path: filePath })
        return JSON.stringify({ ok: true, data: results }, null, 2)
      },
    },

    // ----- find_test_companions (graph-backed + heuristic) -----
    {
      name: 'find_test_companions',
      description: 'Given a file or symbol, return likely tests, specs, stories, and fixtures.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative path to find test companions for.' },
          symbol: { type: 'string', description: 'Symbol name to find test companions for.' },
          limit: { type: 'number', description: 'Maximum number of companions to return.' },
        },
      },
      category: 'codebase',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        if (!referenceGraph) return JSON.stringify({ error: 'Reference graph service not available' })

        const results = await referenceGraph.findTestCompanions(ctx.projectPath, {
          path: asString(args.path),
          symbol: asString(args.symbol),
          limit: numberOrUndefined(args.limit),
        })
        return JSON.stringify({ ok: true, data: results }, null, 2)
      },
    },

    // ----- find_style_companions (graph-backed + heuristic) -----
    {
      name: 'find_style_companions',
      description: 'Given a component or page file, return likely CSS, module CSS, Sass, or Tailwind-related files.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative path to find style companions for.' },
          limit: { type: 'number', description: 'Maximum number of companions to return.' },
        },
        required: ['path'],
      },
      category: 'codebase',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        if (!ctx.projectPath) return JSON.stringify({ error: 'No project path' })
        if (!referenceGraph) return JSON.stringify({ error: 'Reference graph service not available' })

        const filePath = asString(args.path)
        if (!filePath) return JSON.stringify({ error: 'path is required' })

        const results = await referenceGraph.findStyleCompanions(ctx.projectPath, {
          path: filePath,
          limit: numberOrUndefined(args.limit),
        })
        return JSON.stringify({ ok: true, data: results }, null, 2)
      },
    },
  ]
}
