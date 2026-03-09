/**
 * File tools: read, write, patch, navigate, search.
 *
 * Every tool delegates to the corresponding FileToolService method,
 * serialising the result with safeJsonStringify.
 */

import type { FileToolService } from '../files/FileToolService'
import type { ToolDefinition, ToolExecutionContext } from '../ToolContracts'

// ---------------------------------------------------------------------------
// Arg-parsing helpers
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

function asReadMode(v: unknown): 'full' | 'head' | 'tail' | undefined {
  return v === 'full' || v === 'head' || v === 'tail' ? v : undefined
}

function asListSort(v: unknown): 'name' | 'mtime' | 'size' | undefined {
  return v === 'name' || v === 'mtime' || v === 'size' ? v : undefined
}

function asPatchOperations(
  value: unknown,
): Array<{
  find?: string
  replace?: string
  replaceAll?: boolean
  expectedMatches?: number
  insertBefore?: boolean
  insertAfter?: boolean
  startLine?: number
  endLine?: number
}> | undefined {
  if (!Array.isArray(value)) return undefined
  const operations = value
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      find: stringOrUndefined(item.find),
      replace: stringOrUndefined(item.replace) ?? '',
      replaceAll: boolOrUndefined(item.replaceAll),
      expectedMatches: numberOrUndefined(item.expectedMatches),
      insertBefore: boolOrUndefined(item.insertBefore),
      insertAfter: boolOrUndefined(item.insertAfter),
      startLine: numberOrUndefined(item.startLine),
      endLine: numberOrUndefined(item.endLine),
    }))
  return operations.length > 0 ? operations : undefined
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

export function createFileTools(fileToolService: FileToolService): ToolDefinition[] {
  return [
    // ----- read_file -----
    {
      name: 'read_file',
      description: 'Read a text file from the current project. Supports truncation, line numbers, and head/tail modes.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative path to the file.' },
          maxChars: { type: 'number', description: 'Maximum characters to return (200-20000).' },
          includeLineNumbers: { type: 'boolean', description: 'Prefix each line with its line number.' },
          mode: { type: 'string', enum: ['full', 'head', 'tail'], description: 'Read the full file, just the head, or just the tail.' },
        },
        required: ['path'],
      },
      category: 'file-read',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await fileToolService.readFile({
          projectPath: ctx.projectPath,
          path: asString(args.path),
          maxChars: numberOrUndefined(args.maxChars),
          includeLineNumbers: boolOrUndefined(args.includeLineNumbers),
          mode: asReadMode(args.mode),
        }))
      },
    },

    // ----- read_file_range -----
    {
      name: 'read_file_range',
      description: 'Read a specific line range from a text file, with optional context lines.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative path to the file.' },
          startLine: { type: 'number', description: 'First line to read (1-based).' },
          endLine: { type: 'number', description: 'Last line to read (1-based).' },
          contextBefore: { type: 'number', description: 'Extra lines before the requested range.' },
          contextAfter: { type: 'number', description: 'Extra lines after the requested range.' },
          includeLineNumbers: { type: 'boolean', description: 'Prefix returned lines with their line numbers.' },
        },
        required: ['path'],
      },
      category: 'file-read',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await fileToolService.readFileRange({
          projectPath: ctx.projectPath,
          path: asString(args.path),
          startLine: numberOrUndefined(args.startLine),
          endLine: numberOrUndefined(args.endLine),
          contextBefore: numberOrUndefined(args.contextBefore),
          contextAfter: numberOrUndefined(args.contextAfter),
          includeLineNumbers: boolOrUndefined(args.includeLineNumbers),
        }))
      },
    },

    // ----- read_many_files -----
    {
      name: 'read_many_files',
      description: 'Read several text files from the current project in one call.',
      schema: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: 'List of project-relative file paths.' },
          maxCharsPerFile: { type: 'number', description: 'Maximum characters to return per file.' },
          includeLineNumbers: { type: 'boolean', description: 'Prefix each line with its line number.' },
        },
        required: ['paths'],
      },
      category: 'file-read',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await fileToolService.readManyFiles({
          projectPath: ctx.projectPath,
          paths: stringArrayOrUndefined(args.paths),
          maxCharsPerFile: numberOrUndefined(args.maxCharsPerFile),
          includeLineNumbers: boolOrUndefined(args.includeLineNumbers),
        }))
      },
    },

    // ----- get_file_info -----
    {
      name: 'get_file_info',
      description: 'Get metadata about a file or directory, including size, type, line count, and binary detection.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative path.' },
        },
        required: ['path'],
      },
      category: 'file-read',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await fileToolService.getFileInfo({
          projectPath: ctx.projectPath,
          path: asString(args.path),
        }))
      },
    },

    // ----- get_directory_tree -----
    {
      name: 'get_directory_tree',
      description: 'Return a compact directory tree preview for a project path.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative directory path.' },
          depth: { type: 'number', description: 'Tree depth (1-8).' },
          includeHidden: { type: 'boolean', description: 'Include dotfiles and hidden directories.' },
          maxNodes: { type: 'number', description: 'Maximum number of nodes to include.' },
        },
        required: ['path'],
      },
      category: 'file-read',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await fileToolService.getDirectoryTree({
          projectPath: ctx.projectPath,
          path: asString(args.path),
          depth: numberOrUndefined(args.depth),
          includeHidden: boolOrUndefined(args.includeHidden),
          maxNodes: numberOrUndefined(args.maxNodes),
        }))
      },
    },

    // ----- list_files -----
    {
      name: 'list_files',
      description: 'List files and directories under a project path with depth, filtering, sorting, and pagination.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative directory path.' },
          depth: { type: 'number', description: 'Directory recursion depth (0-10).' },
          includeHidden: { type: 'boolean', description: 'Include dotfiles and hidden directories.' },
          extensions: { type: 'array', items: { type: 'string' }, description: 'Optional file extensions filter, e.g. [".ts", ".tsx"].' },
          filesOnly: { type: 'boolean', description: 'Only include files.' },
          dirsOnly: { type: 'boolean', description: 'Only include directories.' },
          limit: { type: 'number', description: 'Page size (1-1000).' },
          cursor: { type: 'number', description: 'Pagination cursor from the previous response.' },
          sort: { type: 'string', enum: ['name', 'mtime', 'size'], description: 'Sort order for returned entries.' },
        },
        required: ['path'],
      },
      category: 'file-nav',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await fileToolService.listFiles({
          projectPath: ctx.projectPath,
          path: asString(args.path),
          depth: numberOrUndefined(args.depth),
          includeHidden: boolOrUndefined(args.includeHidden),
          extensions: stringArrayOrUndefined(args.extensions),
          filesOnly: boolOrUndefined(args.filesOnly),
          dirsOnly: boolOrUndefined(args.dirsOnly),
          limit: numberOrUndefined(args.limit),
          sort: asListSort(args.sort),
          cursor: numberOrUndefined(args.cursor),
        }))
      },
    },

    // ----- glob_files -----
    {
      name: 'glob_files',
      description: 'Find files by glob pattern within the current project.',
      schema: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern like "**/*.tsx" or "src/**/*.{ts,tsx}".' },
          basePath: { type: 'string', description: 'Project-relative base path to search from.' },
          includeHidden: { type: 'boolean', description: 'Include dotfiles and hidden directories.' },
          limit: { type: 'number', description: 'Maximum number of matches to return.' },
        },
        required: ['pattern'],
      },
      category: 'file-nav',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await fileToolService.globFiles({
          projectPath: ctx.projectPath,
          pattern: asString(args.pattern),
          basePath: asString(args.basePath),
          includeHidden: boolOrUndefined(args.includeHidden),
          limit: numberOrUndefined(args.limit),
        }))
      },
    },

    // ----- grep_files -----
    {
      name: 'grep_files',
      description: 'Search text across project files with regex, extension filters, and contextual snippets.',
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text or regex to search for.' },
          isRegex: { type: 'boolean', description: 'Interpret query as a regular expression.' },
          basePath: { type: 'string', description: 'Project-relative base path to search from.' },
          extensions: { type: 'array', items: { type: 'string' }, description: 'Optional file extension filter.' },
          caseSensitive: { type: 'boolean', description: 'Enable case-sensitive matching.' },
          contextLines: { type: 'number', description: 'Context lines to include around each hit.' },
          limit: { type: 'number', description: 'Maximum number of hits to return.' },
          maxFileBytes: { type: 'number', description: 'Skip files larger than this byte size.' },
          includeHidden: { type: 'boolean', description: 'Include dotfiles and hidden directories.' },
        },
        required: ['query'],
      },
      category: 'file-search',
      safetyLevel: 'safe',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await fileToolService.grepFiles({
          projectPath: ctx.projectPath,
          query: asString(args.query),
          isRegex: boolOrUndefined(args.isRegex),
          basePath: asString(args.basePath),
          extensions: stringArrayOrUndefined(args.extensions),
          caseSensitive: boolOrUndefined(args.caseSensitive),
          contextLines: numberOrUndefined(args.contextLines),
          limit: numberOrUndefined(args.limit),
          maxFileBytes: numberOrUndefined(args.maxFileBytes),
          includeHidden: boolOrUndefined(args.includeHidden),
        }))
      },
    },

    // ----- write_file -----
    {
      name: 'write_file',
      description: 'Create a new text file or rewrite a small existing text file. Overwriting an existing file requires its expected checksum. Supports dryRun mode.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative file path.' },
          content: { type: 'string', description: 'Full UTF-8 file content to write.' },
          createIfMissing: { type: 'boolean', description: 'Allow creating the file if it does not already exist.' },
          expectedChecksum: { type: 'string', description: 'Required when overwriting an existing file. Obtain from read_file or get_file_info.' },
          dryRun: { type: 'boolean', description: 'If true, preview the changes without writing to disk.' },
        },
        required: ['path', 'content'],
      },
      category: 'file-write',
      safetyLevel: 'cautious',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await fileToolService.writeFile({
          projectPath: ctx.projectPath,
          path: asString(args.path),
          content: stringOrUndefined(args.content),
          createIfMissing: boolOrUndefined(args.createIfMissing),
          expectedChecksum: asString(args.expectedChecksum),
          dryRun: boolOrUndefined(args.dryRun),
        }))
      },
    },

    // ----- apply_file_patch -----
    {
      name: 'apply_file_patch',
      description: 'Apply structured text replacements to an existing text file. Supports replace_exact, insert_before, insert_after, and replace_line_range operations. Requires the current checksum to prevent stale writes. Supports dryRun mode for previewing changes.',
      schema: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Project-relative file path.' },
          expectedChecksum: { type: 'string', description: 'Checksum from the latest read of the file.' },
          dryRun: { type: 'boolean', description: 'If true, preview the changes without writing to disk.' },
          operations: {
            type: 'array',
            description: 'Sequential patch operations. Supports: exact text replacement (find+replace), insert_before/insert_after (find+replace+insertBefore/insertAfter), and line-range replacement (startLine+endLine+replace).',
            items: {
              type: 'object',
              properties: {
                find: { type: 'string', description: 'Exact text to find (for text-based operations).' },
                replace: { type: 'string', description: 'Replacement text.' },
                replaceAll: { type: 'boolean', description: 'Replace every occurrence. If false, exactly one match is required.' },
                expectedMatches: { type: 'number', description: 'Exact number of expected matches before replacement.' },
                insertBefore: { type: 'boolean', description: 'Insert replace text before the found text instead of replacing it.' },
                insertAfter: { type: 'boolean', description: 'Insert replace text after the found text instead of replacing it.' },
                startLine: { type: 'number', description: 'Start line for line-range replacement (1-based, inclusive).' },
                endLine: { type: 'number', description: 'End line for line-range replacement (1-based, inclusive).' },
              },
            },
          },
        },
        required: ['path', 'expectedChecksum', 'operations'],
      },
      category: 'file-write',
      safetyLevel: 'cautious',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await fileToolService.applyFilePatch({
          projectPath: ctx.projectPath,
          path: asString(args.path),
          expectedChecksum: asString(args.expectedChecksum),
          dryRun: boolOrUndefined(args.dryRun),
          operations: asPatchOperations(args.operations),
        }))
      },
    },

    // ----- move_path -----
    {
      name: 'move_path',
      description: 'Rename or move a file or directory within the current project. Optionally guards file moves with an expected checksum.',
      schema: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'Existing project-relative source path.' },
          to: { type: 'string', description: 'Project-relative destination path.' },
          expectedChecksum: { type: 'string', description: 'Optional checksum guard for file moves.' },
        },
        required: ['from', 'to'],
      },
      category: 'file-write',
      safetyLevel: 'cautious',
      execute: async (ctx: ToolExecutionContext, args: Record<string, unknown>): Promise<string> => {
        return safeJsonStringify(await fileToolService.movePath({
          projectPath: ctx.projectPath,
          from: asString(args.from),
          to: asString(args.to),
          expectedChecksum: asString(args.expectedChecksum),
        }))
      },
    },
  ]
}
