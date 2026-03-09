import { createHash } from 'crypto'
import type { Dirent } from 'fs'
import fs from 'fs/promises'
import path from 'path'

export interface FileToolResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  meta?: Record<string, unknown>
  hints?: {
    suggestedNextTools?: string[]
  }
}

export interface ResolvedProjectPath {
  inputPath: string
  projectRoot: string
  resolvedPath: string
  relativePath: string
}

interface WalkEntry {
  name: string
  absPath: string
  relativePath: string
  relativeToBasePath: string
  kind: 'file' | 'directory' | 'symlink'
  depth: number
  size: number | null
  modifiedAt: string | null
}

interface WalkResult {
  entries: WalkEntry[]
  truncated: boolean
}

const DEFAULT_READ_MAX_CHARS = 8000
const MAX_READ_MAX_CHARS = 20000
const DEFAULT_BATCH_MAX_CHARS = 2000
const DEFAULT_LIST_LIMIT = 200
const MAX_LIST_LIMIT = 1000
const DEFAULT_TREE_MAX_NODES = 250
const MAX_TREE_MAX_NODES = 1000
const DEFAULT_GREP_LIMIT = 50
const MAX_GREP_LIMIT = 300
const DEFAULT_GREP_MAX_FILE_BYTES = 512_000
const MAX_GREP_MAX_FILE_BYTES = 2_000_000
const MAX_SEARCH_WALK_ENTRIES = 10_000

interface SafeProjectTarget {
  projectRoot: string
  targetPath: string
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join('/')
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function normalizeExtensions(extensions?: string[]): string[] | undefined {
  if (!extensions || extensions.length === 0) return undefined
  const normalized = extensions
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean)
    .map((ext) => ext.startsWith('.') ? ext : `.${ext}`)
  return normalized.length > 0 ? Array.from(new Set(normalized)) : undefined
}

function ensureVisible(name: string, includeHidden: boolean): boolean {
  return includeHidden || !name.startsWith('.')
}

function formatLines(lines: string[], startLine: number, includeLineNumbers: boolean): string {
  if (!includeLineNumbers) return lines.join('\n')
  return lines
    .map((line, index) => `${String(startLine + index).padStart(4, ' ')} | ${line}`)
    .join('\n')
}

function truncateText(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false }
  return {
    content: `${content.slice(0, Math.max(0, maxChars - 25))}\n... [truncated]`,
    truncated: true,
  }
}

function compareEntries(a: WalkEntry, b: WalkEntry, sort: string): number {
  if (sort === 'mtime') {
    const aTime = a.modifiedAt ? Date.parse(a.modifiedAt) : 0
    const bTime = b.modifiedAt ? Date.parse(b.modifiedAt) : 0
    return bTime - aTime || a.relativePath.localeCompare(b.relativePath)
  }
  if (sort === 'size') {
    const aSize = a.size ?? -1
    const bSize = b.size ?? -1
    return bSize - aSize || a.relativePath.localeCompare(b.relativePath)
  }
  if (a.kind !== b.kind) {
    return a.kind === 'directory' ? -1 : 1
  }
  return a.relativePath.localeCompare(b.relativePath)
}

function expandBracePattern(pattern: string): string[] {
  const match = pattern.match(/\{([^{}]+)\}/)
  if (!match) return [pattern]

  const [raw, inner] = match
  const choices = inner.split(',').map((part) => part.trim()).filter(Boolean)
  if (choices.length === 0) return [pattern]

  const prefix = pattern.slice(0, match.index)
  const suffix = pattern.slice((match.index ?? 0) + raw.length)
  return choices.flatMap((choice) => expandBracePattern(`${prefix}${choice}${suffix}`))
}

function normalizeGlobPattern(pattern: string): string {
  const trimmed = toPosixPath(pattern.trim()).replace(/^\.\//, '')
  if (!trimmed.includes('/')) return `**/${trimmed}`
  return trimmed
}

function escapeRegexChar(char: string): string {
  return /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char
}

function globPatternToRegExp(pattern: string): RegExp {
  let regex = '^'

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    const next = pattern[i + 1]

    if (char === '*') {
      if (next === '*') {
        const after = pattern[i + 2]
        if (after === '/') {
          regex += '(?:.*/)?'
          i += 2
        } else {
          regex += '.*'
          i += 1
        }
      } else {
        regex += '[^/]*'
      }
      continue
    }

    if (char === '?') {
      regex += '[^/]'
      continue
    }

    regex += escapeRegexChar(char)
  }

  regex += '$'
  return new RegExp(regex)
}

async function detectBinaryFile(filePath: string): Promise<boolean> {
  const handle = await fs.open(filePath, 'r')
  try {
    const buffer = Buffer.alloc(4096)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const sample = buffer.subarray(0, bytesRead)
    if (sample.includes(0)) return true

    let suspicious = 0
    for (const byte of sample) {
      const printable = byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)
      if (!printable) suspicious++
    }
    return sample.length > 0 && suspicious / sample.length > 0.3
  } finally {
    await handle.close()
  }
}

async function readUtf8Text(filePath: string): Promise<string> {
  return fs.readFile(filePath, 'utf-8')
}

function formatChecksum(hash: string): string {
  return `sha256:${hash}`
}

async function computeFileChecksum(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)
  return formatChecksum(createHash('sha256').update(buffer).digest('hex'))
}

function checksumFromText(content: string): string {
  return formatChecksum(createHash('sha256').update(content, 'utf-8').digest('hex'))
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

async function findNearestExistingAncestor(targetPath: string): Promise<string | null> {
  let current = path.resolve(targetPath)

  while (true) {
    if (await pathExists(current)) return current
    const parent = path.dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function summarizeTextDiff(before: string, after: string): Record<string, unknown> {
  const beforeLines = before.split(/\r?\n/)
  const afterLines = after.split(/\r?\n/)

  return {
    changed: before !== after,
    beforeBytes: Buffer.byteLength(before, 'utf-8'),
    afterBytes: Buffer.byteLength(after, 'utf-8'),
    byteDelta: Buffer.byteLength(after, 'utf-8') - Buffer.byteLength(before, 'utf-8'),
    beforeLineCount: beforeLines.length,
    afterLineCount: afterLines.length,
    lineDelta: afterLines.length - beforeLines.length,
  }
}

function countOccurrences(content: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let index = 0
  while (true) {
    const found = content.indexOf(needle, index)
    if (found === -1) return count
    count += 1
    index = found + needle.length
  }
}

function replaceFirst(content: string, find: string, replace: string): string {
  const index = content.indexOf(find)
  if (index === -1) return content
  return `${content.slice(0, index)}${replace}${content.slice(index + find.length)}`
}

async function resolveExistingPathWithinProject(
  resolved: ResolvedProjectPath
): Promise<SafeProjectTarget> {
  const realProjectRoot = await fs.realpath(resolved.projectRoot).catch(() => resolved.projectRoot)
  const realTargetPath = await fs.realpath(resolved.resolvedPath)

  if (!isWithinRoot(realProjectRoot, realTargetPath)) {
    throw new Error(`Resolved path escapes project root via symlink: ${resolved.relativePath}`)
  }

  return {
    projectRoot: realProjectRoot,
    targetPath: realTargetPath,
  }
}

async function resolveWritablePathWithinProject(
  resolved: ResolvedProjectPath
): Promise<SafeProjectTarget> {
  const realProjectRoot = await fs.realpath(resolved.projectRoot).catch(() => resolved.projectRoot)
  const existingAncestor = await findNearestExistingAncestor(resolved.resolvedPath)
  if (!existingAncestor) {
    throw new Error(`Cannot resolve a writable parent for path: ${resolved.relativePath}`)
  }

  const realAncestor = await fs.realpath(existingAncestor)
  if (!isWithinRoot(realProjectRoot, realAncestor)) {
    throw new Error(`Resolved path escapes project root via symlink: ${resolved.relativePath}`)
  }

  return {
    projectRoot: realProjectRoot,
    targetPath: resolved.resolvedPath,
  }
}

async function walkEntries(
  projectRoot: string,
  basePath: string,
  options: {
    maxDepth: number
    maxEntries: number
    includeHidden: boolean
    extensions?: string[]
    includeFiles?: boolean
    includeDirectories?: boolean
  }
): Promise<WalkResult> {
  const queue: Array<{ dirPath: string; depth: number }> = [{ dirPath: basePath, depth: 0 }]
  const entries: WalkEntry[] = []
  let truncated = false

  while (queue.length > 0 && entries.length < options.maxEntries) {
    const current = queue.shift()!
    let dirents: Dirent<string>[]

    try {
      dirents = await fs.readdir(current.dirPath, { withFileTypes: true })
    } catch {
      continue
    }

    dirents.sort((a, b) => a.name.localeCompare(b.name))

    for (const dirent of dirents) {
      if (!ensureVisible(dirent.name, options.includeHidden)) continue

      const absPath = path.join(current.dirPath, dirent.name)
      const relativePath = toPosixPath(path.relative(projectRoot, absPath))
      const relativeToBasePath = toPosixPath(path.relative(basePath, absPath))
      const stats = await fs.lstat(absPath).catch(() => null)
      if (!stats) continue

      const kind: WalkEntry['kind'] = stats.isSymbolicLink()
        ? 'symlink'
        : stats.isDirectory()
          ? 'directory'
          : 'file'

      const extensionMatch = options.extensions && kind === 'file'
        ? options.extensions.includes(path.extname(dirent.name).toLowerCase())
        : true

      const shouldInclude =
        ((kind === 'directory' && options.includeDirectories !== false) ||
          (kind !== 'directory' && options.includeFiles !== false)) &&
        extensionMatch

      if (shouldInclude) {
        entries.push({
          name: dirent.name,
          absPath,
          relativePath,
          relativeToBasePath,
          kind,
          depth: current.depth + 1,
          size: kind === 'file' ? stats.size : null,
          modifiedAt: stats.mtime.toISOString(),
        })
      }

      if (entries.length >= options.maxEntries) {
        truncated = true
        break
      }

      if (kind === 'directory' && current.depth < options.maxDepth) {
        queue.push({ dirPath: absPath, depth: current.depth + 1 })
      }
    }
  }

  if (queue.length > 0) truncated = true

  return { entries, truncated }
}

export function resolveProjectScopedPath(
  inputPath: string | undefined,
  projectPath: string | null,
  options?: {
    defaultPath?: string
    basePath?: string
    allowOutsideProject?: boolean
  }
): ResolvedProjectPath {
  if (!projectPath) {
    throw new Error('No project path is available for file tools.')
  }

  const projectRoot = path.resolve(projectPath)
  const defaultPath = options?.defaultPath ?? '.'
  const rawInput = (inputPath && inputPath.trim()) || defaultPath

  const baseCandidate = options?.basePath
    ? path.isAbsolute(options.basePath)
      ? path.resolve(options.basePath)
      : path.resolve(projectRoot, options.basePath)
    : projectRoot

  if (!options?.allowOutsideProject && !isWithinRoot(projectRoot, baseCandidate)) {
    throw new Error(`Base path escapes the project root: ${options?.basePath}`)
  }

  const resolvedPath = path.isAbsolute(rawInput)
    ? path.resolve(rawInput)
    : path.resolve(baseCandidate, rawInput)

  if (!options?.allowOutsideProject && !isWithinRoot(projectRoot, resolvedPath)) {
    throw new Error(`Path escapes project root: ${rawInput}`)
  }

  const relativePath = isWithinRoot(projectRoot, resolvedPath)
    ? toPosixPath(path.relative(projectRoot, resolvedPath) || '.')
    : toPosixPath(resolvedPath)

  return {
    inputPath: rawInput,
    projectRoot,
    resolvedPath,
    relativePath,
  }
}

export class FileToolService {
  async getFileInfo(args: {
    projectPath: string | null
    path?: string
  }): Promise<FileToolResult> {
    try {
      const resolved = resolveProjectScopedPath(args.path, args.projectPath)
      const safe = await resolveExistingPathWithinProject(resolved)
      const stats = await fs.lstat(safe.targetPath)
      const kind: WalkEntry['kind'] = stats.isSymbolicLink()
        ? 'symlink'
        : stats.isDirectory()
          ? 'directory'
          : 'file'

      let isBinary = false
      let lineCount: number | null = null
      let checksum: string | null = null
      if (kind === 'file') {
        isBinary = await detectBinaryFile(safe.targetPath)
        checksum = await computeFileChecksum(safe.targetPath)
        if (!isBinary) {
          const content = await readUtf8Text(safe.targetPath)
          lineCount = content.split(/\r?\n/).length
        }
      }

      return {
        ok: true,
        data: {
          path: resolved.relativePath,
          kind,
          size: kind === 'file' ? stats.size : null,
          modifiedAt: stats.mtime.toISOString(),
          isBinary,
          lineCount,
          checksum,
        },
        meta: {
          projectRoot: safe.projectRoot,
          resolvedPath: safe.targetPath,
          checksum,
        },
        hints: {
          suggestedNextTools: kind === 'directory'
            ? ['list_files', 'get_directory_tree']
            : isBinary
              ? ['list_files']
              : ['read_file', 'read_file_range'],
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async readFile(args: {
    projectPath: string | null
    path?: string
    maxChars?: number
    includeLineNumbers?: boolean
    mode?: 'full' | 'head' | 'tail'
  }): Promise<FileToolResult> {
    try {
      const resolved = resolveProjectScopedPath(args.path, args.projectPath)
      const safe = await resolveExistingPathWithinProject(resolved)
      const stats = await fs.stat(safe.targetPath)
      if (!stats.isFile()) {
        return { ok: false, error: `Path is not a file: ${resolved.relativePath}` }
      }

      const isBinary = await detectBinaryFile(safe.targetPath)
      if (isBinary) {
        return {
          ok: false,
          error: `File appears to be binary and cannot be read as text: ${resolved.relativePath}`,
        }
      }

      const maxChars = clampNumber(args.maxChars, 200, MAX_READ_MAX_CHARS, DEFAULT_READ_MAX_CHARS)
      const includeLineNumbers = args.includeLineNumbers === true
      const mode = args.mode ?? 'full'

      const content = await readUtf8Text(safe.targetPath)
      const allLines = content.split(/\r?\n/)
      const lineCount = allLines.length
      const checksum = checksumFromText(content)
      let prepared = content
      let startLine = 1

      if (mode === 'head') {
        prepared = formatLines(allLines.slice(0, Math.min(lineCount, 120)), 1, includeLineNumbers)
      } else if (mode === 'tail') {
        const tailCount = Math.min(lineCount, 120)
        startLine = Math.max(1, lineCount - tailCount + 1)
        prepared = formatLines(allLines.slice(-tailCount), startLine, includeLineNumbers)
      } else if (includeLineNumbers) {
        prepared = formatLines(allLines, 1, true)
      }

      const truncated = truncateText(prepared, maxChars)
      return {
        ok: true,
        data: {
          path: resolved.relativePath,
          content: truncated.content,
        },
        meta: {
          projectRoot: safe.projectRoot,
          resolvedPath: safe.targetPath,
          mode,
          lineCount,
          checksum,
          truncated: truncated.truncated,
        },
        hints: {
          suggestedNextTools: truncated.truncated
            ? ['read_file_range', 'get_file_info']
            : ['grep_files', 'read_file_range'],
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async readFileRange(args: {
    projectPath: string | null
    path?: string
    startLine?: number
    endLine?: number
    contextBefore?: number
    contextAfter?: number
    includeLineNumbers?: boolean
  }): Promise<FileToolResult> {
    try {
      const resolved = resolveProjectScopedPath(args.path, args.projectPath)
      const safe = await resolveExistingPathWithinProject(resolved)
      const stats = await fs.stat(safe.targetPath)
      if (!stats.isFile()) {
        return { ok: false, error: `Path is not a file: ${resolved.relativePath}` }
      }

      const isBinary = await detectBinaryFile(safe.targetPath)
      if (isBinary) {
        return {
          ok: false,
          error: `File appears to be binary and cannot be read as text: ${resolved.relativePath}`,
        }
      }

      const content = await readUtf8Text(safe.targetPath)
      const lines = content.split(/\r?\n/)
      const totalLines = lines.length
      const checksum = checksumFromText(content)
      const startLine = clampNumber(args.startLine, 1, totalLines || 1, 1)
      const endLine = clampNumber(args.endLine, startLine, totalLines || startLine, Math.min(totalLines || startLine, startLine + 79))
      const contextBefore = clampNumber(args.contextBefore, 0, 50, 0)
      const contextAfter = clampNumber(args.contextAfter, 0, 50, 0)
      const finalStart = Math.max(1, startLine - contextBefore)
      const finalEnd = Math.min(totalLines, endLine + contextAfter)
      const slice = lines.slice(finalStart - 1, finalEnd)

      return {
        ok: true,
        data: {
          path: resolved.relativePath,
          content: formatLines(slice, finalStart, args.includeLineNumbers !== false),
        },
        meta: {
          projectRoot: safe.projectRoot,
          resolvedPath: safe.targetPath,
          requestedRange: { startLine, endLine },
          returnedRange: { startLine: finalStart, endLine: finalEnd },
          totalLines,
          checksum,
        },
        hints: {
          suggestedNextTools: ['read_file', 'grep_files'],
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async readManyFiles(args: {
    projectPath: string | null
    paths?: string[]
    maxCharsPerFile?: number
    includeLineNumbers?: boolean
  }): Promise<FileToolResult> {
    const paths = args.paths?.filter((item) => typeof item === 'string' && item.trim()) ?? []
    if (paths.length === 0) {
      return { ok: false, error: 'paths must be a non-empty array' }
    }

    const maxCharsPerFile = clampNumber(args.maxCharsPerFile, 200, MAX_READ_MAX_CHARS, DEFAULT_BATCH_MAX_CHARS)
    const files = await Promise.all(paths.slice(0, 20).map(async (filePath) => {
      const result = await this.readFile({
        projectPath: args.projectPath,
        path: filePath,
        maxChars: maxCharsPerFile,
        includeLineNumbers: args.includeLineNumbers,
      })

      return {
        requestedPath: filePath,
        ...result,
      }
    }))

    return {
      ok: true,
      data: {
        files,
      },
      meta: {
        requestedCount: paths.length,
        returnedCount: files.length,
      },
      hints: {
        suggestedNextTools: ['read_file_range', 'grep_files'],
      },
    }
  }

  async listFiles(args: {
    projectPath: string | null
    path?: string
    depth?: number
    includeHidden?: boolean
    extensions?: string[]
    filesOnly?: boolean
    dirsOnly?: boolean
    limit?: number
    sort?: 'name' | 'mtime' | 'size'
    cursor?: number
  }): Promise<FileToolResult> {
    try {
      const resolved = resolveProjectScopedPath(args.path, args.projectPath)
      const safe = await resolveExistingPathWithinProject(resolved)
      const stats = await fs.stat(safe.targetPath)
      if (!stats.isDirectory()) {
        return { ok: false, error: `Path is not a directory: ${resolved.relativePath}` }
      }

      const depth = clampNumber(args.depth, 0, 10, 0)
      const includeHidden = args.includeHidden === true
      const limit = clampNumber(args.limit, 1, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT)
      const cursor = clampNumber(args.cursor, 0, Number.MAX_SAFE_INTEGER, 0)
      const extensions = normalizeExtensions(args.extensions)
      const sort = args.sort ?? 'name'

      const walk = await walkEntries(safe.projectRoot, safe.targetPath, {
        maxDepth: depth,
        maxEntries: MAX_LIST_LIMIT + cursor,
        includeHidden,
        extensions,
        includeFiles: args.dirsOnly !== true,
        includeDirectories: args.filesOnly !== true,
      })

      const sorted = walk.entries.sort((a, b) => compareEntries(a, b, sort))
      const paged = sorted.slice(cursor, cursor + limit)
      const nextCursor = cursor + limit < sorted.length || walk.truncated ? cursor + limit : null

      return {
        ok: true,
        data: {
          entries: paged.map((entry) => ({
            name: entry.name,
            path: entry.relativePath,
            relativeToBasePath: entry.relativeToBasePath || '.',
            kind: entry.kind,
            size: entry.size,
            modifiedAt: entry.modifiedAt,
            depth: entry.depth,
          })),
        },
        meta: {
          projectRoot: safe.projectRoot,
          basePath: resolved.relativePath,
          cursor,
          nextCursor,
          totalVisibleEntries: sorted.length,
          truncated: walk.truncated,
        },
        hints: {
          suggestedNextTools: ['get_directory_tree', 'read_file', 'glob_files'],
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async getDirectoryTree(args: {
    projectPath: string | null
    path?: string
    depth?: number
    includeHidden?: boolean
    maxNodes?: number
  }): Promise<FileToolResult> {
    try {
      const resolved = resolveProjectScopedPath(args.path, args.projectPath)
      const safe = await resolveExistingPathWithinProject(resolved)
      const stats = await fs.stat(safe.targetPath)
      if (!stats.isDirectory()) {
        return { ok: false, error: `Path is not a directory: ${resolved.relativePath}` }
      }

      const depth = clampNumber(args.depth, 1, 8, 2)
      const maxNodes = clampNumber(args.maxNodes, 10, MAX_TREE_MAX_NODES, DEFAULT_TREE_MAX_NODES)
      const includeHidden = args.includeHidden === true

      const walk = await walkEntries(safe.projectRoot, safe.targetPath, {
        maxDepth: depth,
        maxEntries: maxNodes,
        includeHidden,
      })

      const nodes = walk.entries
        .sort((a, b) => compareEntries(a, b, 'name'))
        .map((entry) => ({
          name: entry.name,
          path: entry.relativePath,
          relativeToBasePath: entry.relativeToBasePath || '.',
          kind: entry.kind,
          depth: entry.depth,
        }))

      const rootLabel = resolved.relativePath === '.' ? '.' : resolved.relativePath
      const treeLines = [rootLabel]
      for (const entry of nodes) {
        const indent = '  '.repeat(entry.depth)
        const marker = entry.kind === 'directory' ? '[dir]' : entry.kind === 'symlink' ? '[link]' : '-'
        treeLines.push(`${indent}${marker} ${entry.relativeToBasePath}`)
      }

      return {
        ok: true,
        data: {
          tree: treeLines.join('\n'),
          nodes,
        },
        meta: {
          projectRoot: safe.projectRoot,
          basePath: resolved.relativePath,
          depth,
          maxNodes,
          truncated: walk.truncated,
        },
        hints: {
          suggestedNextTools: ['list_files', 'read_file', 'glob_files'],
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async globFiles(args: {
    projectPath: string | null
    pattern?: string
    basePath?: string
    includeHidden?: boolean
    limit?: number
  }): Promise<FileToolResult> {
    try {
      const pattern = args.pattern?.trim()
      if (!pattern) return { ok: false, error: 'pattern is required' }

      const base = resolveProjectScopedPath(args.basePath, args.projectPath)
      const safe = await resolveExistingPathWithinProject(base)
      const includeHidden = args.includeHidden === true
      const limit = clampNumber(args.limit, 1, MAX_LIST_LIMIT, DEFAULT_LIST_LIMIT)
      const regexes = Array.from(new Set(
        expandBracePattern(normalizeGlobPattern(pattern)).map((expanded) => globPatternToRegExp(expanded))
      ))

      const walk = await walkEntries(safe.projectRoot, safe.targetPath, {
        maxDepth: 20,
        maxEntries: MAX_SEARCH_WALK_ENTRIES,
        includeHidden,
        includeFiles: true,
        includeDirectories: false,
      })

      const matches = walk.entries
        .filter((entry) => regexes.some((regex) => regex.test(entry.relativeToBasePath)))
        .slice(0, limit)

      return {
        ok: true,
        data: {
          matches: matches.map((entry) => ({
            path: entry.relativePath,
            relativeToBasePath: entry.relativeToBasePath,
            size: entry.size,
            modifiedAt: entry.modifiedAt,
          })),
        },
        meta: {
          projectRoot: safe.projectRoot,
          basePath: base.relativePath,
          pattern,
          truncated: matches.length >= limit || walk.truncated,
        },
        hints: {
          suggestedNextTools: ['read_file', 'read_many_files', 'grep_files'],
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async grepFiles(args: {
    projectPath: string | null
    query?: string
    isRegex?: boolean
    basePath?: string
    extensions?: string[]
    caseSensitive?: boolean
    contextLines?: number
    limit?: number
    maxFileBytes?: number
    includeHidden?: boolean
  }): Promise<FileToolResult> {
    try {
      const query = args.query?.trim()
      if (!query) return { ok: false, error: 'query is required' }

      const base = resolveProjectScopedPath(args.basePath, args.projectPath)
      const safe = await resolveExistingPathWithinProject(base)
      const extensions = normalizeExtensions(args.extensions)
      const limit = clampNumber(args.limit, 1, MAX_GREP_LIMIT, DEFAULT_GREP_LIMIT)
      const contextLines = clampNumber(args.contextLines, 0, 10, 0)
      const maxFileBytes = clampNumber(args.maxFileBytes, 1024, MAX_GREP_MAX_FILE_BYTES, DEFAULT_GREP_MAX_FILE_BYTES)
      const includeHidden = args.includeHidden === true

      let matcher: RegExp
      try {
        matcher = args.isRegex
          ? new RegExp(query, args.caseSensitive ? 'g' : 'gi')
          : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), args.caseSensitive ? 'g' : 'gi')
      } catch (error) {
        return { ok: false, error: `Invalid regex: ${error instanceof Error ? error.message : String(error)}` }
      }

      const walk = await walkEntries(safe.projectRoot, safe.targetPath, {
        maxDepth: 20,
        maxEntries: MAX_SEARCH_WALK_ENTRIES,
        includeHidden,
        extensions,
        includeFiles: true,
        includeDirectories: false,
      })

      const hits: Array<Record<string, unknown>> = []
      let scannedFiles = 0
      let skippedLargeFiles = 0
      let skippedBinaryFiles = 0

      for (const entry of walk.entries) {
        if (hits.length >= limit) break
        if ((entry.size ?? 0) > maxFileBytes) {
          skippedLargeFiles++
          continue
        }
        if (await detectBinaryFile(entry.absPath)) {
          skippedBinaryFiles++
          continue
        }

        scannedFiles++
        const content = await readUtf8Text(entry.absPath)
        const lines = content.split(/\r?\n/)

        for (let lineIndex = 0; lineIndex < lines.length && hits.length < limit; lineIndex++) {
          const line = lines[lineIndex]
          matcher.lastIndex = 0
          const match = matcher.exec(line)
          if (!match) continue

          const from = Math.max(0, lineIndex - contextLines)
          const to = Math.min(lines.length, lineIndex + contextLines + 1)

          hits.push({
            path: entry.relativePath,
            line: lineIndex + 1,
            column: match.index + 1,
            match: match[0],
            preview: line,
            context: lines.slice(from, to).map((ctxLine, index) => ({
              line: from + index + 1,
              text: ctxLine,
            })),
          })
        }
      }

      return {
        ok: true,
        data: {
          hits,
        },
        meta: {
          projectRoot: safe.projectRoot,
          basePath: base.relativePath,
          query,
          scannedFiles,
          skippedLargeFiles,
          skippedBinaryFiles,
          truncated: hits.length >= limit || walk.truncated,
        },
        hints: {
          suggestedNextTools: ['read_file_range', 'read_many_files', 'search_code'],
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async writeFile(args: {
    projectPath: string | null
    path?: string
    content?: string
    createIfMissing?: boolean
    expectedChecksum?: string
    dryRun?: boolean
  }): Promise<FileToolResult> {
    try {
      const content = typeof args.content === 'string' ? args.content : null
      if (content === null) return { ok: false, error: 'content is required' }

      const resolved = resolveProjectScopedPath(args.path, args.projectPath)
      const writable = await resolveWritablePathWithinProject(resolved)
      const exists = await pathExists(resolved.resolvedPath)
      const createIfMissing = args.createIfMissing !== false
      const dryRun = args.dryRun === true

      let previousChecksum: string | null = null
      let previousContent = ''
      let operation: 'created' | 'updated' = 'created'

      if (exists) {
        operation = 'updated'
        const safe = await resolveExistingPathWithinProject(resolved)
        const stats = await fs.stat(safe.targetPath)
        if (!stats.isFile()) {
          return { ok: false, error: `Path is not a file: ${resolved.relativePath}` }
        }
        if (await detectBinaryFile(safe.targetPath)) {
          return {
            ok: false,
            error: `File appears to be binary and cannot be overwritten as text: ${resolved.relativePath}`,
          }
        }

        previousContent = await readUtf8Text(safe.targetPath)
        previousChecksum = checksumFromText(previousContent)
        if (!args.expectedChecksum) {
          return {
            ok: false,
            error: `expectedChecksum is required when overwriting an existing file: ${resolved.relativePath}`,
            meta: { currentChecksum: previousChecksum },
            hints: { suggestedNextTools: ['read_file', 'get_file_info'] },
          }
        }
        if (args.expectedChecksum !== previousChecksum) {
          return {
            ok: false,
            error: `Checksum mismatch for ${resolved.relativePath}: expected ${args.expectedChecksum}, current is ${previousChecksum}. The file was modified since you last read it.`,
            meta: { currentChecksum: previousChecksum },
            hints: { suggestedNextTools: ['read_file', 'read_file_range', 'git_diff'] },
          }
        }
      } else if (!createIfMissing) {
        return {
          ok: false,
          error: `File does not exist: ${resolved.relativePath}. File creation was blocked because createIfMissing=false.`,
        }
      }

      const newChecksum = checksumFromText(content)
      const diffSummary = summarizeTextDiff(previousContent, content)

      if (dryRun) {
        return {
          ok: true,
          data: {
            path: resolved.relativePath,
            operation,
            wouldApply: true,
            applied: false,
            dryRun: true,
            checksumBefore: previousChecksum,
            checksumAfter: newChecksum,
            diffSummary,
          },
          meta: { projectRoot: writable.projectRoot },
          hints: { suggestedNextTools: ['write_file'] },
        }
      }

      await fs.mkdir(path.dirname(writable.targetPath), { recursive: true })
      await fs.writeFile(writable.targetPath, content, 'utf-8')

      return {
        ok: true,
        data: {
          path: resolved.relativePath,
          operation,
          applied: true,
          checksumBefore: previousChecksum,
          checksumAfter: newChecksum,
          diffSummary,
        },
        meta: {
          projectRoot: writable.projectRoot,
          resolvedPath: writable.targetPath,
          checksum: newChecksum,
        },
        hints: {
          suggestedNextTools: ['read_file', 'git_diff', 'grep_files'],
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async applyFilePatch(args: {
    projectPath: string | null
    path?: string
    expectedChecksum?: string
    dryRun?: boolean
    operations?: Array<{
      find?: string
      replace?: string
      replaceAll?: boolean
      expectedMatches?: number
      /** Insert the replacement text before the found text instead of replacing it */
      insertBefore?: boolean
      /** Insert the replacement text after the found text instead of replacing it */
      insertAfter?: boolean
      /** Replace a line range instead of exact text. Uses 1-based line numbers. */
      startLine?: number
      /** End line for line-range replacement (inclusive, 1-based) */
      endLine?: number
    }>
  }): Promise<FileToolResult> {
    try {
      if (!args.expectedChecksum) {
        return { ok: false, error: 'expectedChecksum is required' }
      }

      const operations = Array.isArray(args.operations) ? args.operations : []
      if (operations.length === 0) {
        return { ok: false, error: 'operations must be a non-empty array' }
      }

      const resolved = resolveProjectScopedPath(args.path, args.projectPath)
      const safe = await resolveExistingPathWithinProject(resolved)
      const stats = await fs.stat(safe.targetPath)
      if (!stats.isFile()) {
        return { ok: false, error: `Path is not a file: ${resolved.relativePath}` }
      }
      if (await detectBinaryFile(safe.targetPath)) {
        return {
          ok: false,
          error: `File appears to be binary and cannot be patched as text: ${resolved.relativePath}`,
        }
      }

      const originalContent = await readUtf8Text(safe.targetPath)
      const currentChecksum = checksumFromText(originalContent)
      if (args.expectedChecksum !== currentChecksum) {
        return {
          ok: false,
          error: `Checksum mismatch for ${resolved.relativePath}: expected ${args.expectedChecksum}, current is ${currentChecksum}. The file was modified since you last read it.`,
          meta: { currentChecksum },
          hints: {
            suggestedNextTools: ['read_file', 'read_file_range', 'git_diff'],
          },
        }
      }

      const dryRun = args.dryRun === true
      let nextContent = originalContent
      const operationSummaries: Array<Record<string, unknown>> = []

      for (let index = 0; index < operations.length; index++) {
        const operation = operations[index]
        const replace = typeof operation.replace === 'string' ? operation.replace : ''
        const isLineRange = typeof operation.startLine === 'number' && typeof operation.endLine === 'number'

        if (isLineRange) {
          // Line-range replacement
          const startLine = operation.startLine as number
          const endLine = operation.endLine as number
          const lines = nextContent.split('\n')

          if (startLine < 1 || endLine < startLine || endLine > lines.length) {
            return {
              ok: false,
              error: `operations[${index}] line range ${startLine}-${endLine} is out of bounds (file has ${lines.length} lines)`,
            }
          }

          const before = lines.slice(0, startLine - 1)
          const after = lines.slice(endLine)
          nextContent = [...before, replace, ...after].join('\n')

          operationSummaries.push({
            index,
            kind: 'replace_line_range',
            startLine,
            endLine,
            linesReplaced: endLine - startLine + 1,
          })
        } else {
          // Text-based operations (replace_exact, insert_before, insert_after)
          const find = typeof operation.find === 'string' ? operation.find : ''
          const replaceAll = operation.replaceAll === true
          const insertBefore = operation.insertBefore === true
          const insertAfter = operation.insertAfter === true
          const expectedMatches = clampNumber(operation.expectedMatches, 1, 1000, 1)

          if (!find) {
            return { ok: false, error: `operations[${index}].find is required` }
          }

          const matchCount = countOccurrences(nextContent, find)

          // Determine the actual replacement text
          let effectiveReplace: string
          if (insertBefore) {
            effectiveReplace = replace + find
          } else if (insertAfter) {
            effectiveReplace = find + replace
          } else {
            effectiveReplace = replace
          }

          const kind = insertBefore ? 'insert_before' : insertAfter ? 'insert_after' : 'replace_exact'

          if (replaceAll) {
            if (matchCount !== expectedMatches) {
              return {
                ok: false,
                error: `operations[${index}] expected ${expectedMatches} matches for replaceAll, but found ${matchCount}`,
              }
            }
            nextContent = nextContent.split(find).join(effectiveReplace)
          } else {
            if (expectedMatches !== 1 || matchCount !== 1) {
              return {
                ok: false,
                error: `operations[${index}] requires exactly 1 match for single replacement, but found ${matchCount}`,
              }
            }
            nextContent = replaceFirst(nextContent, find, effectiveReplace)
          }

          operationSummaries.push({
            index,
            kind,
            replaceAll,
            expectedMatches,
            matched: matchCount,
            findPreview: truncateText(find, 160).content,
          })
        }
      }

      const newChecksum = checksumFromText(nextContent)
      const diffSummary = summarizeTextDiff(originalContent, nextContent)

      if (dryRun) {
        return {
          ok: true,
          data: {
            path: resolved.relativePath,
            wouldApply: true,
            applied: false,
            dryRun: true,
            checksumBefore: currentChecksum,
            checksumAfter: newChecksum,
            operationCount: operations.length,
            operations: operationSummaries,
            diffSummary,
          },
          meta: {
            projectRoot: safe.projectRoot,
          },
          hints: {
            suggestedNextTools: ['apply_file_patch'],
          },
        }
      }

      await fs.writeFile(safe.targetPath, nextContent, 'utf-8')

      return {
        ok: true,
        data: {
          path: resolved.relativePath,
          applied: true,
          checksumBefore: currentChecksum,
          checksumAfter: newChecksum,
          operationCount: operations.length,
          operations: operationSummaries,
          diffSummary,
        },
        meta: {
          projectRoot: safe.projectRoot,
          resolvedPath: safe.targetPath,
          checksum: newChecksum,
        },
        hints: {
          suggestedNextTools: ['read_file', 'read_file_range', 'git_diff'],
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async movePath(args: {
    projectPath: string | null
    from?: string
    to?: string
    expectedChecksum?: string
  }): Promise<FileToolResult> {
    try {
      const source = resolveProjectScopedPath(args.from, args.projectPath)
      const destination = resolveProjectScopedPath(args.to, args.projectPath)
      if (!(await pathExists(source.resolvedPath))) {
        return { ok: false, error: `Source path does not exist: ${source.relativePath}` }
      }
      if (await pathExists(destination.resolvedPath)) {
        return { ok: false, error: `Destination path already exists: ${destination.relativePath}` }
      }

      const safeSource = await resolveExistingPathWithinProject(source)
      const safeDestination = await resolveWritablePathWithinProject(destination)

      const sourceStats = await fs.stat(safeSource.targetPath)
      let checksum: string | null = null
      if (sourceStats.isFile()) {
        checksum = await computeFileChecksum(safeSource.targetPath)
        if (args.expectedChecksum && args.expectedChecksum !== checksum) {
          return {
            ok: false,
            error: `Stale file state for ${source.relativePath}: expected ${args.expectedChecksum}, got ${checksum}`,
            meta: { currentChecksum: checksum },
          }
        }
      }

      await fs.mkdir(path.dirname(safeDestination.targetPath), { recursive: true })
      await fs.rename(safeSource.targetPath, safeDestination.targetPath)

      return {
        ok: true,
        data: {
          applied: true,
          kind: sourceStats.isDirectory() ? 'directory' : 'file',
          from: source.relativePath,
          to: destination.relativePath,
          checksum,
        },
        meta: {
          projectRoot: safeSource.projectRoot,
          fromResolvedPath: safeSource.targetPath,
          toResolvedPath: safeDestination.targetPath,
        },
        hints: {
          suggestedNextTools: ['list_files', 'read_file', 'git_diff'],
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }
}
