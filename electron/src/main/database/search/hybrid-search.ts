/**
 * Hybrid search engine combining FTS5 keyword search with cosine similarity vector search.
 * Adaptive weighting based on query classification.
 */
import Database from 'better-sqlite3'
import type { CodeChunk } from '@shared/models'
import { ChunkDAO } from '../dao/ChunkDAO'
import { EmbeddingCache } from './embedding-cache'
import { preprocessQuery, type ProcessedQuery } from './query-preprocessor'
import { vectorSearch } from './vector-search'

export interface SearchResult {
  chunkId: string
  fileId: string
  projectId: string
  chunkType: string
  symbolName: string | null
  content: string
  startLine: number | null
  endLine: number | null
  score: number
  matchType: 'keyword' | 'semantic' | 'hybrid'
}

export class HybridSearchEngine {
  private chunkDAO: ChunkDAO
  private embeddingCache: EmbeddingCache

  constructor(private db: Database.Database, embeddingCache?: EmbeddingCache) {
    this.chunkDAO = new ChunkDAO(db)
    this.embeddingCache = embeddingCache ?? new EmbeddingCache()
  }

  search(
    projectId: string,
    query: string,
    queryEmbedding: Float32Array | null,
    limit: number = 10
  ): { results: SearchResult[]; processedQuery: ProcessedQuery } {
    const processed = preprocessQuery(query)

    // 1. FTS keyword search
    const ftsResults = this.chunkDAO.searchFTS(projectId, query, limit * 2)
    const keywordScores = new Map<string, number>()
    const chunkMap = new Map<string, CodeChunk>()
    if (ftsResults.length > 0) {
      const maxRank = Math.max(...ftsResults.map((r) => r.rank))
      for (const result of ftsResults) {
        keywordScores.set(result.id, maxRank > 0 ? result.rank / maxRank : 0)
        chunkMap.set(result.id, result)
      }
    }

    // 2. Vector search (if embedding provided)
    const semanticScores = new Map<string, number>()
    if (queryEmbedding) {
      const vectorResults = this.vectorSearchOptimized(
        projectId,
        queryEmbedding,
        limit * 2
      )
      for (const result of vectorResults) {
        semanticScores.set(result.id, result.score)
        if (!chunkMap.has(result.id)) {
          chunkMap.set(result.id, result.chunk)
        }
      }
    }

    // 3. Merge with adaptive weights
    const allChunkIds = new Set([
      ...keywordScores.keys(),
      ...semanticScores.keys(),
    ])
    const merged: SearchResult[] = []

    for (const chunkId of allChunkIds) {
      const kScore = keywordScores.get(chunkId) ?? 0
      const sScore = semanticScores.get(chunkId) ?? 0

      let matchType: 'keyword' | 'semantic' | 'hybrid' = 'hybrid'
      if (kScore > 0 && sScore === 0) matchType = 'keyword'
      else if (sScore > 0 && kScore === 0) matchType = 'semantic'

      const combinedScore =
        kScore * processed.keywordWeight + sScore * processed.semanticWeight

      const chunk = chunkMap.get(chunkId)
      if (!chunk) continue

      merged.push({
        chunkId: chunk.id,
        fileId: chunk.fileId,
        projectId: chunk.projectId,
        chunkType: chunk.chunkType,
        symbolName: chunk.symbolName,
        content: chunk.content,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        score: combinedScore,
        matchType,
      })
    }

    // 4. Sort by score descending
    merged.sort((a, b) => b.score - a.score)

    // 5. Consolidate: max 2 chunks per file
    const perFile = new Map<string, number>()
    const consolidated = merged.filter((r) => {
      const count = perFile.get(r.fileId) ?? 0
      if (count >= 2) return false
      perFile.set(r.fileId, count + 1)
      return true
    })

    return {
      results: consolidated.slice(0, limit),
      processedQuery: processed,
    }
  }

  invalidateProjectCache(projectId: string): void {
    this.embeddingCache.invalidate(projectId)
  }

  invalidateAllCaches(): void {
    this.embeddingCache.invalidateAll()
  }

  private vectorSearchOptimized(
    projectId: string,
    queryEmbedding: Float32Array,
    topN: number
  ): Array<{ id: string; score: number; chunk: CodeChunk }> {
    let embeddings = this.embeddingCache.get(projectId)

    if (!embeddings) {
      embeddings = this.chunkDAO.getEmbeddingsOnly(projectId).map((item) => ({
        id: item.id,
        embedding: new Float32Array(
          item.embedding.buffer,
          item.embedding.byteOffset,
          item.embedding.byteLength / 4
        ),
      }))
      this.embeddingCache.set(projectId, embeddings)
    }

    if (embeddings.length === 0) return []

    const ranked = vectorSearch(queryEmbedding, embeddings, topN)
    if (ranked.length === 0) return []

    const chunks = this.chunkDAO.getByIds(ranked.map((item) => item.id))
    const chunkMap = new Map(chunks.map((chunk) => [chunk.id, chunk]))

    return ranked
      .map((item) => ({
        id: item.id,
        score: item.score,
        chunk: chunkMap.get(item.id) ?? null,
      }))
      .filter((item): item is { id: string; score: number; chunk: CodeChunk } => item.chunk !== null)
  }
}
