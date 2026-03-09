import { existsSync, statSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImportEdge {
  fromFile: string     // project-relative importer
  toFile: string       // project-relative target (resolved)
  toRaw: string        // raw import specifier
  symbols: string[]    // imported symbol names (empty for side-effect imports)
  kind: 'import' | 'dynamic' | 're-export'
}

export interface ExportRecord {
  file: string         // project-relative
  name: string         // exported name ('default' for default exports)
  kind: 'named' | 'default' | 'type' | 'interface' | 're-export'
  line: number
}

export interface ReferenceGraph {
  imports: ImportEdge[]
  exports: ExportRecord[]
  fileCount: number
  buildTimeMs: number
}

export interface ImporterResult {
  file: string
  symbols: string[]
  kind: 'import' | 'dynamic' | 're-export'
  confidence: 'graph' | 'heuristic'
}

export interface ReferenceResult {
  file: string
  line: number
  kind: 'import' | 'usage' | 're-export'
  context: string   // short snippet around the reference
  confidence: 'graph' | 'heuristic'
}

export interface CompanionResult {
  file: string
  kind: 'test' | 'spec' | 'story' | 'fixture' | 'style' | 'module-css' | 'sass' | 'css'
  confidence: 'graph' | 'heuristic'
}

interface PathAlias {
  prefix: string       // e.g. "@/*"
  targets: string[]    // e.g. ["src/*"]
}

interface CachedGraph {
  graph: ReferenceGraph
  createdAt: number
  tsconfigMtime: number | null
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
  '.turbo', '.cache', '.parcel-cache', 'out', '.output',
])

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs'])
const STYLE_EXTENSIONS = new Set(['.css', '.scss', '.sass', '.less', '.styl'])

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs']
const IMPORTABLE_EXTENSIONS = [...RESOLVE_EXTENSIONS, '.css', '.scss', '.sass', '.less', '.styl']

const MAX_FILES = 5000
const MAX_FILE_SIZE = 50 * 1024 // 50 KB
const BUILD_TIMEOUT_MS = 10_000
const CACHE_TTL_MS = 30_000

// ---------------------------------------------------------------------------
// Regex patterns
// ---------------------------------------------------------------------------

// ES static imports:
//   import { X, Y } from 'path'
//   import X from 'path'
//   import * as X from 'path'
//   import 'path'  (side-effect)
//   import X, { Y } from 'path'
const RE_STATIC_IMPORT = /import\s+(?:(?:(\{[^}]*\})|\*\s+as\s+(\w+)|(\w+))(?:\s*,\s*(?:(\{[^}]*\})|(\w+)))?\s+from\s+)?['"]([^'"]+)['"]/g

// Dynamic imports: import('path'), require('path')
const RE_DYNAMIC_IMPORT = /(?:import|require)\s*\(\s*['"]([^'"]+)['"]\s*\)/g

// Re-exports:
//   export { X, Y } from 'path'
//   export * from 'path'
//   export * as X from 'path'
//   export { default as X } from 'path'
const RE_REEXPORT = /export\s+(?:(\{[^}]*\})|\*(?:\s+as\s+(\w+))?)\s+from\s+['"]([^'"]+)['"]/g

// Named exports: export function X, export class X, export const X, etc.
const RE_NAMED_EXPORT = /export\s+(default\s+)?(function\*?|class|const|let|var|type|interface|enum|abstract\s+class)\s+(\w+)/g

// Bare default export: export default (not followed by function/class/const keyword)
const RE_DEFAULT_EXPORT = /^export\s+default\s+(?!function|class|const|let|var|type|interface|enum|abstract)/gm

// Block exports: export { X, Y }  (without from)
const RE_BLOCK_EXPORT = /export\s+\{([^}]+)\}(?!\s*from)/g

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPosix(p: string): string {
  return p.split(path.sep).join('/')
}

function parseSymbolsFromBraces(braces: string): string[] {
  // Remove the braces, split by comma, trim, handle "X as Y" → take Y
  return braces
    .replace(/^\{/, '')
    .replace(/\}$/, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const asMatch = s.match(/\w+\s+as\s+(\w+)/)
      if (asMatch) return asMatch[1]
      // Handle "type X" imports
      const typeMatch = s.match(/^type\s+(\w+)/)
      if (typeMatch) return typeMatch[1]
      return s
    })
}

function parseReexportSymbolsFromBraces(braces: string): string[] {
  // For re-exports we want the original names (before `as`)
  return braces
    .replace(/^\{/, '')
    .replace(/\}$/, '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => {
      const asMatch = s.match(/(\w+)\s+as\s+\w+/)
      if (asMatch) return asMatch[1]
      return s
    })
}

// ---------------------------------------------------------------------------
// ReferenceGraphService
// ---------------------------------------------------------------------------

export class ReferenceGraphService {
  private cache = new Map<string, CachedGraph>()

  invalidate(projectPath?: string): void {
    if (projectPath) {
      this.cache.delete(projectPath)
      return
    }
    this.cache.clear()
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Build the graph by scanning all TS/JS files in projectPath.
   * Uses a simple file walk + regex parsing.
   * Caches by projectPath + mtime of tsconfig.
   */
  async buildGraph(projectPath: string): Promise<ReferenceGraph> {
    const tsconfigMtime = await this.getTsconfigMtime(projectPath)

    const cached = this.cache.get(projectPath)
    if (cached) {
      const age = Date.now() - cached.createdAt
      if (age < CACHE_TTL_MS && cached.tsconfigMtime === tsconfigMtime) {
        return cached.graph
      }
    }

    const startTime = Date.now()
    const deadline = startTime + BUILD_TIMEOUT_MS

    // Resolve tsconfig aliases
    const aliases = await this.loadPathAliases(projectPath)

    // Walk the project tree
    const files = await this.walkProject(projectPath, deadline)

    const allImports: ImportEdge[] = []
    const allExports: ExportRecord[] = []

    for (const absFile of files) {
      if (Date.now() > deadline) break

      const relFile = toPosix(path.relative(projectPath, absFile))

      try {
        const stat = await fs.stat(absFile)
        if (stat.size > MAX_FILE_SIZE) continue

        const content = await fs.readFile(absFile, { encoding: 'utf-8' })
        const lines = content.split('\n')

        // Parse imports
        const fileImports = this.parseImports(content, relFile, projectPath, aliases)
        allImports.push(...fileImports)

        // Parse exports
        const fileExports = this.parseExports(content, relFile, lines)
        allExports.push(...fileExports)
      } catch {
        // Skip files that can't be read or parsed
        continue
      }
    }

    const buildTimeMs = Date.now() - startTime

    const graph: ReferenceGraph = {
      imports: allImports,
      exports: allExports,
      fileCount: files.length,
      buildTimeMs,
    }

    this.cache.set(projectPath, {
      graph,
      createdAt: Date.now(),
      tsconfigMtime,
    })

    return graph
  }

  /**
   * Find files that import a given file or symbol.
   * Returns importers sorted by relevance.
   */
  async findImporters(projectPath: string, opts: {
    path?: string
    symbol?: string
    limit?: number
  }): Promise<ImporterResult[]> {
    const graph = await this.buildGraph(projectPath)
    const limit = Math.min(opts.limit ?? 20, 50)
    const results: ImporterResult[] = []

    const targetPath = opts.path ? toPosix(opts.path) : undefined

    for (const edge of graph.imports) {
      let match = false

      if (targetPath && edge.toFile === targetPath) {
        match = true
      }

      if (opts.symbol && edge.symbols.includes(opts.symbol)) {
        match = true
      }

      // If both filters specified, require both
      if (targetPath && opts.symbol) {
        match = edge.toFile === targetPath && edge.symbols.includes(opts.symbol)
      }

      if (match) {
        results.push({
          file: edge.fromFile,
          symbols: edge.symbols,
          kind: edge.kind,
          confidence: 'graph',
        })
      }
    }

    // Deduplicate by file
    const seen = new Set<string>()
    const unique: ImporterResult[] = []
    for (const r of results) {
      if (seen.has(r.file)) continue
      seen.add(r.file)
      unique.push(r)
    }

    // Sort: exact symbol matches first, then by file path
    unique.sort((a, b) => {
      if (opts.symbol) {
        const aHas = a.symbols.includes(opts.symbol!) ? 0 : 1
        const bHas = b.symbols.includes(opts.symbol!) ? 0 : 1
        if (aHas !== bHas) return aHas - bHas
      }
      return a.file.localeCompare(b.file)
    })

    return unique.slice(0, limit)
  }

  /**
   * Find references to a symbol across the project.
   * Searches for import statements and usage patterns.
   */
  async findReferences(projectPath: string, opts: {
    symbol: string
    path?: string
    limit?: number
  }): Promise<ReferenceResult[]> {
    const graph = await this.buildGraph(projectPath)
    const limit = Math.min(opts.limit ?? 20, 50)
    const results: ReferenceResult[] = []
    const symbol = opts.symbol

    // 1. Find import-based references from the graph
    for (const edge of graph.imports) {
      if (!edge.symbols.includes(symbol)) continue

      // If path filter is given, only match imports pointing to that file
      if (opts.path && edge.toFile !== toPosix(opts.path)) continue

      results.push({
        file: edge.fromFile,
        line: 0, // Line will be found during content scan
        kind: edge.kind === 're-export' ? 're-export' : 'import',
        context: `import { ${edge.symbols.join(', ')} } from '${edge.toRaw}'`,
        confidence: 'graph',
      })
    }

    // 2. Scan files for usage patterns beyond imports
    const filesToScan = new Set<string>()
    for (const r of results) {
      filesToScan.add(r.file)
    }

    // Also scan files where the symbol is exported (definitions)
    for (const exp of graph.exports) {
      if (exp.name === symbol) {
        filesToScan.add(exp.file)
      }
    }

    // Scan each file for actual usage lines
    const usageRegex = new RegExp(`\\b${escapeRegex(symbol)}\\b`, 'g')

    for (const relFile of filesToScan) {
      if (results.length >= limit) break

      try {
        const absFile = path.join(projectPath, relFile)
        const stat = await fs.stat(absFile)
        if (stat.size > MAX_FILE_SIZE) continue

        const content = await fs.readFile(absFile, { encoding: 'utf-8' })
        const lines = content.split('\n')

        for (let i = 0; i < lines.length; i++) {
          if (results.length >= limit) break

          const line = lines[i]
          if (!usageRegex.test(line)) continue
          usageRegex.lastIndex = 0 // reset regex state

          // Skip import/export lines — they are already captured as 'import'/'re-export'
          if (/^\s*(import|export)\s/.test(line)) continue

          results.push({
            file: relFile,
            line: i + 1,
            kind: 'usage',
            context: line.trim().slice(0, 120),
            confidence: 'graph',
          })
        }
      } catch {
        continue
      }
    }

    // Update line numbers for import-based results
    for (const r of results) {
      if (r.line === 0 && (r.kind === 'import' || r.kind === 're-export')) {
        try {
          const absFile = path.join(projectPath, r.file)
          const content = await fs.readFile(absFile, { encoding: 'utf-8' })
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].includes(symbol) && /^\s*(import|export)/.test(lines[i])) {
              r.line = i + 1
              r.context = lines[i].trim().slice(0, 120)
              break
            }
          }
        } catch {
          // keep line 0
        }
      }
    }

    // Deduplicate by file+line
    const seen = new Set<string>()
    const unique: ReferenceResult[] = []
    for (const r of results) {
      const key = `${r.file}:${r.line}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(r)
    }

    // Sort: imports first, then usage, then by file
    unique.sort((a, b) => {
      const kindOrder = { 'import': 0, 're-export': 1, 'usage': 2 }
      const diff = kindOrder[a.kind] - kindOrder[b.kind]
      if (diff !== 0) return diff
      return a.file.localeCompare(b.file) || a.line - b.line
    })

    return unique.slice(0, limit)
  }

  /**
   * List all exports from a file.
   */
  async findExports(projectPath: string, opts: {
    path: string
  }): Promise<ExportRecord[]> {
    const graph = await this.buildGraph(projectPath)
    const targetPath = toPosix(opts.path)

    return graph.exports
      .filter((exp) => exp.file === targetPath)
      .sort((a, b) => a.line - b.line)
  }

  /**
   * Find test/spec/story companion files for a given file.
   * Uses naming conventions and import analysis.
   */
  async findTestCompanions(projectPath: string, opts: {
    path?: string
    symbol?: string
    limit?: number
  }): Promise<CompanionResult[]> {
    const graph = await this.buildGraph(projectPath)
    const limit = Math.min(opts.limit ?? 10, 30)
    const results: CompanionResult[] = []
    const seen = new Set<string>()

    const targetPath = opts.path ? toPosix(opts.path) : undefined

    // Determine the base name to search for
    let baseName: string | undefined
    if (targetPath) {
      const parsed = path.parse(targetPath)
      baseName = parsed.name
        .replace(/\.(test|spec|stories|story)$/, '')
        .replace(/\.module$/, '')
    } else if (opts.symbol) {
      // Try to find which file exports this symbol
      for (const exp of graph.exports) {
        if (exp.name === opts.symbol) {
          const parsed = path.parse(exp.file)
          baseName = parsed.name
            .replace(/\.(test|spec|stories|story)$/, '')
            .replace(/\.module$/, '')
          break
        }
      }
    }

    if (!baseName) return results

    // 1. Heuristic: naming convention match
    const allFiles = new Set<string>()
    for (const edge of graph.imports) {
      allFiles.add(edge.fromFile)
      allFiles.add(edge.toFile)
    }
    for (const exp of graph.exports) {
      allFiles.add(exp.file)
    }

    const testPatterns: Array<{ regex: RegExp; kind: CompanionResult['kind'] }> = [
      { regex: new RegExp(`(^|/)${escapeRegex(baseName)}\\.test\\.[jt]sx?$`), kind: 'test' },
      { regex: new RegExp(`(^|/)${escapeRegex(baseName)}\\.spec\\.[jt]sx?$`), kind: 'spec' },
      { regex: new RegExp(`(^|/)${escapeRegex(baseName)}\\.stories\\.[jt]sx?$`), kind: 'story' },
      { regex: new RegExp(`(^|/)${escapeRegex(baseName)}\\.story\\.[jt]sx?$`), kind: 'story' },
      { regex: new RegExp(`(^|/)__tests__/${escapeRegex(baseName)}\\.[jt]sx?$`), kind: 'test' },
      { regex: new RegExp(`(^|/)__tests__/${escapeRegex(baseName)}\\.test\\.[jt]sx?$`), kind: 'test' },
      { regex: new RegExp(`(^|/)__fixtures__/${escapeRegex(baseName)}\\.[jt]sx?$`), kind: 'fixture' },
    ]

    // Also scan the actual file system for companions not yet in the graph
    if (targetPath) {
      const targetDir = path.dirname(path.join(projectPath, targetPath))
      const parsed = path.parse(targetPath)
      const ext = parsed.ext

      const candidateSuffixes = [
        `.test${ext}`, `.spec${ext}`, `.stories${ext}`, `.story${ext}`,
      ]

      for (const suffix of candidateSuffixes) {
        const candidateAbs = path.join(targetDir, `${baseName}${suffix}`)
        const candidateRel = toPosix(path.relative(projectPath, candidateAbs))

        if (seen.has(candidateRel)) continue

        try {
          await fs.access(candidateAbs)
          const kind = suffix.includes('.test') ? 'test'
            : suffix.includes('.spec') ? 'spec'
            : 'story' as CompanionResult['kind']

          results.push({ file: candidateRel, kind, confidence: 'heuristic' })
          seen.add(candidateRel)
        } catch {
          // file doesn't exist
        }
      }

      // Check __tests__ directory
      const testsDir = path.join(targetDir, '__tests__')
      for (const testExt of RESOLVE_EXTENSIONS) {
        const candidateAbs = path.join(testsDir, `${baseName}${testExt}`)
        const candidateRel = toPosix(path.relative(projectPath, candidateAbs))

        if (seen.has(candidateRel)) continue

        try {
          await fs.access(candidateAbs)
          results.push({ file: candidateRel, kind: 'test', confidence: 'heuristic' })
          seen.add(candidateRel)
        } catch {
          // file doesn't exist
        }
      }
    }

    // Check all known files against patterns
    for (const file of allFiles) {
      if (seen.has(file)) continue

      for (const { regex, kind } of testPatterns) {
        if (regex.test(file)) {
          results.push({ file, kind, confidence: 'heuristic' })
          seen.add(file)
          break
        }
      }
    }

    // 2. Graph-based: test files that import the target
    if (targetPath) {
      for (const edge of graph.imports) {
        if (edge.toFile !== targetPath) continue
        if (seen.has(edge.fromFile)) continue

        const fromBase = path.basename(edge.fromFile).toLowerCase()
        if (fromBase.includes('.test.') || fromBase.includes('.spec.')) {
          results.push({ file: edge.fromFile, kind: 'test', confidence: 'graph' })
          seen.add(edge.fromFile)
        } else if (fromBase.includes('.stories.') || fromBase.includes('.story.')) {
          results.push({ file: edge.fromFile, kind: 'story', confidence: 'graph' })
          seen.add(edge.fromFile)
        }
      }
    }

    // Sort: graph confidence first, then heuristic, then by file
    results.sort((a, b) => {
      const confOrder = { graph: 0, heuristic: 1 }
      const diff = confOrder[a.confidence] - confOrder[b.confidence]
      if (diff !== 0) return diff
      return a.file.localeCompare(b.file)
    })

    return results.slice(0, limit)
  }

  /**
   * Find style companion files (CSS modules, Sass, Tailwind).
   */
  async findStyleCompanions(projectPath: string, opts: {
    path: string
    limit?: number
  }): Promise<CompanionResult[]> {
    const graph = await this.buildGraph(projectPath)
    const limit = Math.min(opts.limit ?? 10, 30)
    const results: CompanionResult[] = []
    const seen = new Set<string>()

    const targetPath = toPosix(opts.path)
    const parsed = path.parse(targetPath)
    const baseName = parsed.name
      .replace(/\.(test|spec|stories|story)$/, '')
      .replace(/\.module$/, '')

    // 1. Graph-based: CSS/SCSS imports from the target file
    for (const edge of graph.imports) {
      if (edge.fromFile !== targetPath) continue

      const extLower = path.extname(edge.toRaw).toLowerCase()
      if (['.css', '.scss', '.sass', '.less', '.styl'].includes(extLower)) {
        const kind = this.classifyStyleFile(edge.toRaw)
        if (!seen.has(edge.toFile)) {
          results.push({ file: edge.toFile, kind, confidence: 'graph' })
          seen.add(edge.toFile)
        }
      }
    }

    // 2. Heuristic: naming convention match
    const targetDir = path.dirname(path.join(projectPath, targetPath))

    const styleSuffixes: Array<{ suffix: string; kind: CompanionResult['kind'] }> = [
      { suffix: '.module.css', kind: 'module-css' },
      { suffix: '.module.scss', kind: 'module-css' },
      { suffix: '.css', kind: 'css' },
      { suffix: '.scss', kind: 'sass' },
      { suffix: '.sass', kind: 'sass' },
      { suffix: '.styles.ts', kind: 'style' },
      { suffix: '.styles.tsx', kind: 'style' },
      { suffix: '.styles.js', kind: 'style' },
    ]

    for (const { suffix, kind } of styleSuffixes) {
      const candidateAbs = path.join(targetDir, `${baseName}${suffix}`)
      const candidateRel = toPosix(path.relative(projectPath, candidateAbs))

      if (seen.has(candidateRel)) continue

      try {
        await fs.access(candidateAbs)
        results.push({ file: candidateRel, kind, confidence: 'heuristic' })
        seen.add(candidateRel)
      } catch {
        // file doesn't exist
      }
    }

    // Sort: graph confidence first, then heuristic
    results.sort((a, b) => {
      const confOrder = { graph: 0, heuristic: 1 }
      const diff = confOrder[a.confidence] - confOrder[b.confidence]
      if (diff !== 0) return diff
      return a.file.localeCompare(b.file)
    })

    return results.slice(0, limit)
  }

  // -------------------------------------------------------------------------
  // Private: file walking
  // -------------------------------------------------------------------------

  private async walkProject(projectPath: string, deadline: number): Promise<string[]> {
    const files: string[] = []

    const walk = async (dir: string): Promise<void> => {
      if (files.length >= MAX_FILES) return
      if (Date.now() > deadline) return

      let names: string[]
      try {
        names = await fs.readdir(dir)
      } catch {
        return
      }

      for (const name of names) {
        if (files.length >= MAX_FILES) return
        if (Date.now() > deadline) return

        const fullPath = path.join(dir, name)

        let stat
        try {
          stat = await fs.stat(fullPath)
        } catch {
          continue
        }

        if (stat.isDirectory()) {
          if (SKIP_DIRS.has(name) || name.startsWith('.')) continue
          await walk(fullPath)
        } else if (stat.isFile()) {
          const ext = path.extname(name).toLowerCase()
          if (SOURCE_EXTENSIONS.has(ext)) {
            files.push(fullPath)
          }
        }
      }
    }

    await walk(projectPath)
    return files
  }

  // -------------------------------------------------------------------------
  // Private: tsconfig / path aliases
  // -------------------------------------------------------------------------

  private async getTsconfigMtime(projectPath: string): Promise<number | null> {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      try {
        const stat = await fs.stat(path.join(projectPath, name))
        return stat.mtimeMs
      } catch {
        continue
      }
    }
    return null
  }

  private async loadPathAliases(projectPath: string): Promise<PathAlias[]> {
    const aliases: PathAlias[] = []

    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      try {
        const raw = await fs.readFile(path.join(projectPath, name), { encoding: 'utf-8' })
        // Strip single-line comments and trailing commas for lenient JSON parsing
        const cleaned = raw
          .replace(/\/\/.*$/gm, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/,\s*([\]}])/g, '$1')
        const config = JSON.parse(cleaned)

        const baseUrl = config?.compilerOptions?.baseUrl ?? '.'
        const paths = config?.compilerOptions?.paths

        if (paths && typeof paths === 'object') {
          for (const [pattern, targets] of Object.entries(paths)) {
            if (!Array.isArray(targets)) continue
            aliases.push({
              prefix: pattern,
              targets: (targets as string[]).map((t) =>
                toPosix(path.join(baseUrl, t))
              ),
            })
          }
        }

        break // Use the first config found
      } catch {
        continue
      }
    }

    return aliases
  }

  // -------------------------------------------------------------------------
  // Private: import resolution
  // -------------------------------------------------------------------------

  private resolveImportPath(
    rawSpecifier: string,
    fromFileRel: string,
    projectPath: string,
    aliases: PathAlias[],
  ): string | null {
    // Skip bare module specifiers (npm packages)
    if (this.isBareSpecifier(rawSpecifier)) {
      // Check if it matches a path alias
      const aliasResolved = this.resolveAlias(rawSpecifier, aliases)
      if (aliasResolved) {
        return this.resolveFileOnDisk(aliasResolved, projectPath)
      }
      return null
    }

    // Relative import
    if (rawSpecifier.startsWith('.')) {
      const fromDir = path.dirname(path.join(projectPath, fromFileRel))
      const candidateAbs = path.resolve(fromDir, rawSpecifier)
      return this.resolveFileOnDisk(candidateAbs, projectPath)
    }

    // Try as path alias
    const aliasResolved = this.resolveAlias(rawSpecifier, aliases)
    if (aliasResolved) {
      return this.resolveFileOnDisk(aliasResolved, projectPath)
    }

    return null
  }

  private isBareSpecifier(specifier: string): boolean {
    if (specifier.startsWith('.') || specifier.startsWith('/')) return false
    // CSS/SCSS imports
    if (/\.(css|scss|sass|less|styl)$/.test(specifier)) return false
    return true
  }

  private resolveAlias(specifier: string, aliases: PathAlias[]): string | null {
    for (const alias of aliases) {
      const { prefix, targets } = alias

      if (prefix.endsWith('/*')) {
        // Wildcard alias: @/* → src/*
        const aliasBase = prefix.slice(0, -2) // Remove /*
        if (specifier === aliasBase || specifier.startsWith(`${aliasBase}/`)) {
          const rest = specifier.slice(aliasBase.length + 1) // after the /
          for (const target of targets) {
            const targetBase = target.slice(0, -2) // Remove /*
            return toPosix(path.join(targetBase, rest))
          }
        }
      } else {
        // Exact alias
        if (specifier === prefix) {
          return targets[0] ? toPosix(targets[0]) : null
        }
      }
    }
    return null
  }

  private resolveFileOnDisk(relPath: string, projectPath: string): string | null {
    const absolutePath = path.isAbsolute(relPath) ? relPath : path.join(projectPath, relPath)
    return this.resolveFileOnDiskSync(absolutePath, projectPath)
  }

  private resolveFileOnDiskSync(absolutePath: string, projectPath: string): string | null {
    const ext = path.extname(absolutePath).toLowerCase()
    const candidates = new Set<string>()

    candidates.add(absolutePath)

    if (!ext) {
      for (const tryExt of IMPORTABLE_EXTENSIONS) {
        candidates.add(`${absolutePath}${tryExt}`)
      }
      for (const tryExt of RESOLVE_EXTENSIONS) {
        candidates.add(path.join(absolutePath, `index${tryExt}`))
      }
    }

    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue

      let stats
      try {
        stats = statSync(candidate)
      } catch {
        continue
      }

      if (!stats.isFile()) continue
      const candidateExt = path.extname(candidate).toLowerCase()
      if (!SOURCE_EXTENSIONS.has(candidateExt) && !STYLE_EXTENSIONS.has(candidateExt)) {
        continue
      }

      const relative = path.relative(projectPath, candidate)
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
        continue
      }
      return toPosix(relative)
    }

    return null
  }

  // -------------------------------------------------------------------------
  // Private: parsing
  // -------------------------------------------------------------------------

  private parseImports(
    content: string,
    fromFileRel: string,
    projectPath: string,
    aliases: PathAlias[],
  ): ImportEdge[] {
    const edges: ImportEdge[] = []

    // 1. Static imports
    let match: RegExpExecArray | null
    RE_STATIC_IMPORT.lastIndex = 0
    while ((match = RE_STATIC_IMPORT.exec(content)) !== null) {
      const braces = match[1]       // { X, Y }
      const starAs = match[2]       // * as X → X
      const defaultName = match[3]  // import X
      const braces2 = match[4]      // second braces in "import X, { Y }"
      const _default2 = match[5]    // second default in edge cases
      const rawPath = match[6]

      const symbols: string[] = []
      if (braces) symbols.push(...parseSymbolsFromBraces(braces))
      if (starAs) symbols.push(starAs)
      if (defaultName) symbols.push(defaultName)
      if (braces2) symbols.push(...parseSymbolsFromBraces(braces2))
      if (_default2) symbols.push(_default2)

      const resolved = this.resolveImportPath(rawPath, fromFileRel, projectPath, aliases)
      if (!resolved) continue

      edges.push({
        fromFile: fromFileRel,
        toFile: resolved,
        toRaw: rawPath,
        symbols,
        kind: 'import',
      })
    }

    // 2. Dynamic imports
    RE_DYNAMIC_IMPORT.lastIndex = 0
    while ((match = RE_DYNAMIC_IMPORT.exec(content)) !== null) {
      const rawPath = match[1]
      const resolved = this.resolveImportPath(rawPath, fromFileRel, projectPath, aliases)
      if (!resolved) continue

      edges.push({
        fromFile: fromFileRel,
        toFile: resolved,
        toRaw: rawPath,
        symbols: [],
        kind: 'dynamic',
      })
    }

    // 3. Re-exports
    RE_REEXPORT.lastIndex = 0
    while ((match = RE_REEXPORT.exec(content)) !== null) {
      const braces = match[1]    // { X, Y }
      const starAs = match[2]    // * as X
      const rawPath = match[3]

      const symbols: string[] = []
      if (braces) symbols.push(...parseReexportSymbolsFromBraces(braces))
      if (starAs) symbols.push(starAs)
      // "export * from" has no specific symbols

      const resolved = this.resolveImportPath(rawPath, fromFileRel, projectPath, aliases)
      if (!resolved) continue

      edges.push({
        fromFile: fromFileRel,
        toFile: resolved,
        toRaw: rawPath,
        symbols,
        kind: 're-export',
      })
    }

    return edges
  }

  private parseExports(
    content: string,
    fileRel: string,
    _lines: string[],
  ): ExportRecord[] {
    const records: ExportRecord[] = []

    // 1. Named exports with keyword: export (default)? (function|class|const|...) Name
    let match: RegExpExecArray | null
    RE_NAMED_EXPORT.lastIndex = 0
    while ((match = RE_NAMED_EXPORT.exec(content)) !== null) {
      const isDefault = !!match[1]
      const keyword = match[2].trim()
      const name = match[3]
      const line = this.getLineNumber(content, match.index)

      let kind: ExportRecord['kind']
      if (isDefault) {
        kind = 'default'
      } else if (keyword === 'type') {
        kind = 'type'
      } else if (keyword === 'interface') {
        kind = 'interface'
      } else {
        kind = 'named'
      }

      records.push({
        file: fileRel,
        name: isDefault ? 'default' : name,
        kind,
        line,
      })
    }

    // 2. Bare default export: export default <expression>
    RE_DEFAULT_EXPORT.lastIndex = 0
    while ((match = RE_DEFAULT_EXPORT.exec(content)) !== null) {
      const line = this.getLineNumber(content, match.index)
      // Check we haven't already captured this line as a named default
      const alreadyCaptured = records.some((r) =>
        r.file === fileRel && r.kind === 'default' && r.line === line
      )
      if (!alreadyCaptured) {
        records.push({
          file: fileRel,
          name: 'default',
          kind: 'default',
          line,
        })
      }
    }

    // 3. Block exports: export { X, Y, Z }
    RE_BLOCK_EXPORT.lastIndex = 0
    while ((match = RE_BLOCK_EXPORT.exec(content)) !== null) {
      const inner = match[1]
      const line = this.getLineNumber(content, match.index)
      const symbols = inner
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => {
          const asMatch = s.match(/(\w+)\s+as\s+(\w+)/)
          if (asMatch) return asMatch[2] // the alias becomes the exported name
          return s
        })

      for (const sym of symbols) {
        records.push({
          file: fileRel,
          name: sym === 'default' ? 'default' : sym,
          kind: sym === 'default' ? 'default' : 'named',
          line,
        })
      }
    }

    // 4. Re-exports (already parsed as imports, but also record them as exports)
    RE_REEXPORT.lastIndex = 0
    while ((match = RE_REEXPORT.exec(content)) !== null) {
      const braces = match[1]
      const starAs = match[2]
      const line = this.getLineNumber(content, match.index)

      if (braces) {
        const symbols = braces
          .replace(/^\{/, '')
          .replace(/\}$/, '')
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map((s) => {
            const asMatch = s.match(/\w+\s+as\s+(\w+)/)
            if (asMatch) return asMatch[1]
            return s
          })

        for (const sym of symbols) {
          records.push({
            file: fileRel,
            name: sym,
            kind: 're-export',
            line,
          })
        }
      } else if (starAs) {
        records.push({
          file: fileRel,
          name: starAs,
          kind: 're-export',
          line,
        })
      } else {
        // export * from — namespace re-export, no specific name
        records.push({
          file: fileRel,
          name: '*',
          kind: 're-export',
          line,
        })
      }
    }

    return records
  }

  private getLineNumber(content: string, charIndex: number): number {
    let line = 1
    for (let i = 0; i < charIndex && i < content.length; i++) {
      if (content[i] === '\n') line++
    }
    return line
  }

  // -------------------------------------------------------------------------
  // Private: style classification
  // -------------------------------------------------------------------------

  private classifyStyleFile(filePath: string): CompanionResult['kind'] {
    const lower = filePath.toLowerCase()
    if (lower.includes('.module.css')) return 'module-css'
    if (lower.includes('.module.scss') || lower.includes('.module.sass')) return 'module-css'
    if (lower.endsWith('.scss') || lower.endsWith('.sass')) return 'sass'
    return 'css'
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
