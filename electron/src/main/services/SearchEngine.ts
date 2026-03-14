/**
 * High-level search service that orchestrates hybrid search (FTS + vector)
 * with the embedding client for query embeddings.
 *
 * This is a thin orchestrator on top of:
 * - HybridSearchEngine (FTS + vector combination with adaptive weighting)
 * - EmbeddingClient (OpenRouter embeddings with LRU cache)
 * - IndexDAO (for resolving file paths from IndexedFile records)
 */

import Database from 'better-sqlite3'
import { HybridSearchEngine } from '@main/database/search/hybrid-search'
import { IndexDAO } from '@main/database/dao/IndexDAO'
import type { EmbeddingClient } from './EmbeddingClient'

export interface SearchResult {
  chunkId: string
  content: string
  symbolName: string | null
  chunkType: string
  filePath: string | null
  startLine: number | null
  endLine: number | null
  score: number
  matchSource: 'fts' | 'vector' | 'hybrid'
}

export interface SearchOptions {
  /** Maximum number of results to return (default: 10) */
  limit?: number
  /** Filter by chunk types (e.g. ['function', 'class']) */
  types?: string[]
}

export class SearchEngine {
  private hybridEngine: HybridSearchEngine
  private indexDAO: IndexDAO

  constructor(
    private db: Database.Database,
    private embeddingClient: EmbeddingClient
  ) {
    this.hybridEngine = new HybridSearchEngine(db)
    this.indexDAO = new IndexDAO(db)
  }

  /**
   * Search a project's indexed code using hybrid (FTS + vector) search.
   *
   * 1. Runs HybridSearchEngine with optional query embedding
   * 2. Resolves file paths via IndexedFile records
   * 3. Filters by chunk types if specified
   * 4. Returns top N results
   */
  async search(
    projectId: string,
    query: string,
    options?: SearchOptions
  ): Promise<SearchResult[]> {
    const limit = options?.limit ?? 10
    const types = options?.types

    // Get query embedding if the client has an API key
    let queryEmbedding: Float32Array | null = null
    if (this.embeddingClient.hasApiKey()) {
      try {
        queryEmbedding = await this.embeddingClient.getEmbedding(query)
      } catch {
        // Fall back to FTS-only search if embedding fails
        queryEmbedding = null
      }
    }

    // Run hybrid search (handles FTS + vector combination internally)
    const { results } = this.hybridEngine.search(
      projectId,
      query,
      queryEmbedding,
      // Request more results than needed so we can filter by type
      types ? limit * 3 : limit
    )

    // Build a map of fileId → relativePath for resolving file paths
    const fileIds = [...new Set(results.map((result) => result.fileId))]
    const filePathMap = this.indexDAO.getPathsByIds(fileIds)

    // Map to SearchResult shape, resolve file paths, filter by type
    let mapped: SearchResult[] = results.map((r) => ({
      chunkId: r.chunkId,
      content: r.content,
      symbolName: r.symbolName,
      chunkType: r.chunkType,
      filePath: filePathMap.get(r.fileId) ?? null,
      startLine: r.startLine,
      endLine: r.endLine,
      score: r.score,
      matchSource: r.matchType === 'keyword'
        ? 'fts' as const
        : r.matchType === 'semantic'
          ? 'vector' as const
          : 'hybrid' as const,
    }))

    // Filter by chunk types if specified
    if (types && types.length > 0) {
      const typeSet = new Set(types)
      mapped = mapped.filter((r) => typeSet.has(r.chunkType))
    }

    return mapped.slice(0, limit)
  }

  invalidateProjectCache(projectId: string): void {
    this.hybridEngine.invalidateProjectCache(projectId)
  }

  invalidateAllCaches(): void {
    this.hybridEngine.invalidateAllCaches()
  }
}
