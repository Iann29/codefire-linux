export interface CachedProjectEmbeddings {
  embeddings: Array<{ id: string; embedding: Float32Array }>
  timestamp: number
}

export class EmbeddingCache {
  private cache = new Map<string, CachedProjectEmbeddings>()

  constructor(private maxAgeMs = 60_000) {}

  get(projectId: string): Array<{ id: string; embedding: Float32Array }> | null {
    const entry = this.cache.get(projectId)
    if (!entry) return null

    if (Date.now() - entry.timestamp > this.maxAgeMs) {
      this.cache.delete(projectId)
      return null
    }

    return entry.embeddings
  }

  set(projectId: string, embeddings: Array<{ id: string; embedding: Float32Array }>): void {
    this.cache.set(projectId, {
      embeddings,
      timestamp: Date.now(),
    })
  }

  invalidate(projectId: string): void {
    this.cache.delete(projectId)
  }

  invalidateAll(): void {
    this.cache.clear()
  }
}
