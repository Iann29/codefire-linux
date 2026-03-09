import path from 'path'
import type Database from 'better-sqlite3'

import { ChunkDAO } from '@main/database/dao/ChunkDAO'
import { IndexDAO } from '@main/database/dao/IndexDAO'
import { resolveProjectScopedPath } from '../files/FileToolService'

export interface CodebaseToolResult<T = unknown> {
  ok: boolean
  data?: T
  error?: string
  meta?: Record<string, unknown>
  hints?: {
    suggestedNextTools?: string[]
  }
}

interface SymbolMatchRecord {
  symbol: string
  chunkType: string
  path: string
  startLine: number | null
  endLine: number | null
  score: number
  matchKind: 'exact' | 'qualified' | 'prefix' | 'contains' | 'fts'
  contentPreview: string
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/')
}

function truncatePreview(content: string, maxChars: number = 220): string {
  const normalized = content.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 16))}... [truncated]`
}

function normalizeStem(filePath: string): string {
  const base = path.basename(filePath).toLowerCase()
  const withoutExt = base.replace(/\.[^.]+$/, '')
  return withoutExt
    .replace(/(\.test|\.spec|\.stories|\.story|\.d|\.module|\.styles?)$/g, '')
    .replace(/^index$/, '')
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)))
}

function scoreSymbolMatch(query: string, symbolName: string): Pick<SymbolMatchRecord, 'score' | 'matchKind'> {
  const normalizedQuery = query.trim().toLowerCase()
  const normalizedSymbol = symbolName.trim().toLowerCase()

  if (normalizedSymbol === normalizedQuery) {
    return { score: 1, matchKind: 'exact' }
  }
  if (normalizedSymbol.endsWith(`.${normalizedQuery}`)) {
    return { score: 0.95, matchKind: 'qualified' }
  }
  if (normalizedSymbol.startsWith(normalizedQuery)) {
    return { score: 0.88, matchKind: 'prefix' }
  }
  if (normalizedSymbol.includes(normalizedQuery)) {
    return { score: 0.75, matchKind: 'contains' }
  }
  return { score: 0.55, matchKind: 'fts' }
}

function scorePathRelation(seedPath: string, candidatePath: string): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  if (seedPath === candidatePath) return { score: 0, reasons }

  const seedDir = path.posix.dirname(seedPath)
  const candidateDir = path.posix.dirname(candidatePath)
  const seedStem = normalizeStem(seedPath)
  const candidateStem = normalizeStem(candidatePath)
  const seedBase = path.posix.basename(seedPath).toLowerCase()
  const candidateBase = path.posix.basename(candidatePath).toLowerCase()

  if (seedDir === candidateDir) {
    score += 24
    reasons.push('same-directory')
  }

  if (seedStem && seedStem === candidateStem) {
    score += 60
    reasons.push('same-stem')
  }

  if (
    seedBase.includes(candidateStem) ||
    candidateBase.includes(seedStem)
  ) {
    score += 24
    reasons.push('counterpart-name')
  }

  const seedSegments = seedPath.split('/')
  const candidateSegments = candidatePath.split('/')
  const sharedSegments = seedSegments.filter((segment, index) => candidateSegments[index] === segment).length
  if (sharedSegments > 1) {
    score += Math.min(12, sharedSegments * 3)
    reasons.push('shared-path-prefix')
  }

  return { score, reasons: uniqueStrings(reasons) }
}

export class CodebaseToolService {
  private readonly chunkDAO: ChunkDAO
  private readonly indexDAO: IndexDAO

  constructor(private readonly db: Database.Database) {
    this.chunkDAO = new ChunkDAO(db)
    this.indexDAO = new IndexDAO(db)
  }

  async findSymbol(args: {
    projectId: string | null
    query?: string
    types?: string[]
    limit?: number
  }): Promise<CodebaseToolResult> {
    try {
      if (!args.projectId) return { ok: false, error: 'No project selected' }
      const query = args.query?.trim()
      if (!query) return { ok: false, error: 'query is required' }

      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 30) : 10
      const indexedFiles = this.indexDAO.listByProject(args.projectId)
      const filePathMap = new Map(indexedFiles.map((file) => [file.id, file.relativePath]))

      const directMatches = this.chunkDAO.findBySymbol(args.projectId, query, {
        limit: limit * 3,
        types: args.types,
      })
      const ftsMatches = this.chunkDAO.searchFTS(args.projectId, query, limit * 4)
        .filter((chunk) => typeof chunk.symbolName === 'string' && chunk.symbolName.trim().length > 0)
        .filter((chunk) => !args.types?.length || args.types.includes(chunk.chunkType))

      const seen = new Set<string>()
      const matches: SymbolMatchRecord[] = []

      for (const chunk of [...directMatches, ...ftsMatches]) {
        if (!chunk.symbolName) continue
        if (seen.has(chunk.id)) continue
        const filePath = filePathMap.get(chunk.fileId)
        if (!filePath) continue

        seen.add(chunk.id)
        const ranked = scoreSymbolMatch(query, chunk.symbolName)
        matches.push({
          symbol: chunk.symbolName,
          chunkType: chunk.chunkType,
          path: filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          score: ranked.score,
          matchKind: ranked.matchKind,
          contentPreview: truncatePreview(chunk.content),
        })
      }

      matches.sort((a, b) =>
        b.score - a.score ||
        a.symbol.localeCompare(b.symbol) ||
        a.path.localeCompare(b.path)
      )

      return {
        ok: true,
        data: {
          matches: matches.slice(0, limit),
        },
        meta: {
          query,
          matchCount: matches.length,
          indexedFileCount: indexedFiles.length,
        },
        hints: {
          suggestedNextTools: ['read_file_range', 'read_file', 'find_related_files'],
        },
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async findRelatedFiles(args: {
    projectId: string | null
    projectPath: string | null
    path?: string
    symbol?: string
    query?: string
    limit?: number
  }): Promise<CodebaseToolResult> {
    try {
      if (!args.projectId) return { ok: false, error: 'No project selected' }

      const indexedFiles = this.indexDAO.listByProject(args.projectId)
      if (indexedFiles.length === 0) {
        return { ok: false, error: 'No indexed files available for this project' }
      }

      const limit = typeof args.limit === 'number' && args.limit > 0 ? Math.min(args.limit, 30) : 12
      const seedPaths = new Set<string>()

      if (args.path) {
        const resolved = resolveProjectScopedPath(args.path, args.projectPath)
        seedPaths.add(toPosix(resolved.relativePath))
      }

      const term = args.symbol?.trim() || args.query?.trim() || Array.from(seedPaths)[0]?.split('/').pop() || ''
      const symbolMatches = term
        ? await this.findSymbol({
            projectId: args.projectId,
            query: term,
            limit: 6,
          })
        : null

      if (symbolMatches?.ok) {
        const symbolRecords = (symbolMatches.data as { matches?: SymbolMatchRecord[] } | undefined)?.matches ?? []
        for (const match of symbolRecords) {
          if (match.matchKind === 'fts' || match.score < 0.75) continue
          seedPaths.add(match.path)
        }
      }

      if (seedPaths.size === 0 && !term) {
        return { ok: false, error: 'Provide path, symbol, or query to find related files' }
      }

      const contentHits = term
        ? this.chunkDAO.searchFTS(args.projectId, term, 30)
        : []
      const filePathMap = new Map(indexedFiles.map((file) => [file.id, file.relativePath]))
      const contentHitBoost = new Map<string, number>()
      for (const chunk of contentHits) {
        const filePath = filePathMap.get(chunk.fileId)
        if (!filePath) continue
        contentHitBoost.set(filePath, (contentHitBoost.get(filePath) ?? 0) + 1)
      }

      const candidates = indexedFiles
        .map((file) => {
          if (seedPaths.has(file.relativePath)) return null

          let score = 0
          const reasons: string[] = []

          for (const seedPath of seedPaths) {
            const related = scorePathRelation(seedPath, file.relativePath)
            score += related.score
            reasons.push(...related.reasons)
          }

          if (term) {
            const loweredTerm = term.toLowerCase()
            const loweredPath = file.relativePath.toLowerCase()
            const loweredBase = path.posix.basename(file.relativePath).toLowerCase()

            if (loweredBase.includes(loweredTerm)) {
              score += 32
              reasons.push('basename-matches-query')
            } else if (loweredPath.includes(loweredTerm)) {
              score += 16
              reasons.push('path-matches-query')
            }
          }

          const hitCount = contentHitBoost.get(file.relativePath) ?? 0
          if (hitCount > 0) {
            score += Math.min(36, hitCount * 8)
            reasons.push('content-hit')
          }

          if (score <= 0) return null

          return {
            path: file.relativePath,
            language: file.language,
            score,
            reasons: uniqueStrings(reasons),
            evidence: {
              contentHitCount: hitCount,
            },
          }
        })
        .filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))

      return {
        ok: true,
        data: {
          seedPaths: Array.from(seedPaths),
          relatedFiles: candidates.slice(0, limit),
        },
        meta: {
          term: term || null,
          seedCount: seedPaths.size,
          indexedFileCount: indexedFiles.length,
        },
        hints: {
          suggestedNextTools: ['read_many_files', 'read_file', 'grep_files'],
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
