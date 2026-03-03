/**
 * Client for generating text embeddings via OpenRouter API.
 * Includes an LRU cache (max 50 entries) to avoid redundant API calls.
 */

import { createHash } from 'crypto'

const EMBEDDING_ENDPOINT = 'https://openrouter.ai/api/v1/embeddings'
const EMBEDDING_MODEL = 'openai/text-embedding-3-large'
const EMBEDDING_DIMENSIONS = 1536
const CACHE_MAX_SIZE = 50
const RATE_LIMIT_DELAY_MS = 1000

export class EmbeddingClient {
  private apiKey: string | null
  private cache: Map<string, Float32Array>

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? null
    this.cache = new Map()
  }

  /**
   * Set the API key for OpenRouter.
   */
  setApiKey(apiKey: string): void {
    this.apiKey = apiKey
  }

  /**
   * Check whether an API key is configured.
   */
  hasApiKey(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0
  }

  /**
   * Get a single embedding for a text string.
   * Returns a cached result if available.
   */
  async getEmbedding(text: string): Promise<Float32Array> {
    const cacheKey = this.getCacheKey(text)

    // Check cache
    const cached = this.cache.get(cacheKey)
    if (cached) {
      // Move to end (most recently used) by deleting and re-inserting
      this.cache.delete(cacheKey)
      this.cache.set(cacheKey, cached)
      return cached
    }

    // Call API
    const embeddings = await this.callAPI([text])
    const embedding = embeddings[0]

    // Cache result
    this.cacheSet(cacheKey, embedding)

    return embedding
  }

  /**
   * Get embeddings for multiple texts in a single API call.
   * Individual texts are cached and checked before making the request.
   */
  async getEmbeddings(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return []

    // Check which texts are already cached
    const results: (Float32Array | null)[] = new Array(texts.length).fill(null)
    const uncachedIndices: number[] = []
    const uncachedTexts: string[] = []

    for (let i = 0; i < texts.length; i++) {
      const cacheKey = this.getCacheKey(texts[i])
      const cached = this.cache.get(cacheKey)
      if (cached) {
        // Move to end (LRU)
        this.cache.delete(cacheKey)
        this.cache.set(cacheKey, cached)
        results[i] = cached
      } else {
        uncachedIndices.push(i)
        uncachedTexts.push(texts[i])
      }
    }

    // If everything was cached, return immediately
    if (uncachedTexts.length === 0) {
      return results as Float32Array[]
    }

    // Call API for uncached texts
    const newEmbeddings = await this.callAPI(uncachedTexts)

    // Fill in results and cache
    for (let j = 0; j < uncachedIndices.length; j++) {
      const idx = uncachedIndices[j]
      const embedding = newEmbeddings[j]
      results[idx] = embedding
      this.cacheSet(this.getCacheKey(texts[idx]), embedding)
    }

    return results as Float32Array[]
  }

  /**
   * Clear the embedding cache.
   */
  clearCache(): void {
    this.cache.clear()
  }

  // ─── Private ────────────────────────────────────────────────────────────────

  /**
   * Generate a cache key from text content.
   * Uses a SHA-256 hash for long texts to keep memory usage low.
   */
  private getCacheKey(text: string): string {
    if (text.length <= 200) return text
    return createHash('sha256').update(text).digest('hex')
  }

  /**
   * Add an entry to the cache with LRU eviction.
   */
  private cacheSet(key: string, value: Float32Array): void {
    // Evict oldest entry if cache is full
    if (this.cache.size >= CACHE_MAX_SIZE) {
      const firstKey = this.cache.keys().next().value as string
      this.cache.delete(firstKey)
    }
    this.cache.set(key, value)
  }

  /**
   * Call the OpenRouter embeddings API.
   * Retries once on 429 (rate limit) after a 1-second delay.
   */
  private async callAPI(
    input: string | string[],
    isRetry = false
  ): Promise<Float32Array[]> {
    if (!this.apiKey) {
      throw new Error(
        'No API key configured. Call setApiKey() or pass an API key to the constructor.'
      )
    }

    const response = await fetch(EMBEDDING_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input,
        dimensions: EMBEDDING_DIMENSIONS,
      }),
    })

    if (!response.ok) {
      // Retry once on rate limit
      if (response.status === 429 && !isRetry) {
        await this.delay(RATE_LIMIT_DELAY_MS)
        return this.callAPI(input, true)
      }

      throw new Error(
        `OpenRouter API error: ${response.status} ${response.statusText}`
      )
    }

    const json = (await response.json()) as {
      data: Array<{ embedding: number[] }>
    }

    return json.data.map((d) => new Float32Array(d.embedding))
  }

  /**
   * Utility: sleep for a given duration.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
