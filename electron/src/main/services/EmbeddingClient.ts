/**
 * Multi-provider embedding client.
 *
 * Routes embedding requests to OpenRouter (for OpenAI models) or
 * the Gemini API (for Google models) based on the configured model ID.
 * Includes an LRU cache (max 50 entries) to avoid redundant API calls.
 */

import { createHash } from 'crypto'

// ─── Constants ──────────────────────────────────────────────────────────────

const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/embeddings'
const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta'
const DEFAULT_DIMENSIONS = 1536
const CACHE_MAX_SIZE = 50
const RATE_LIMIT_DELAY_MS = 1000
const MAX_RATE_LIMIT_RETRIES = 3

// ─── Types ──────────────────────────────────────────────────────────────────

export type EmbeddingTaskType = 'document' | 'query'

export type EmbeddingProvider = 'openrouter' | 'gemini'

export interface EmbeddingClientConfig {
  model: string
  dimensions?: number
  openRouterKey?: string
  googleAiApiKey?: string
}

// ─── Model Registry ─────────────────────────────────────────────────────────

/** Known embedding models and their provider routing. */
const MODEL_PROVIDER_MAP: Record<string, EmbeddingProvider> = {
  'openai/text-embedding-3-small': 'openrouter',
  'openai/text-embedding-3-large': 'openrouter',
  'google/gemini-embedding-2-preview': 'gemini',
}

/**
 * Resolve the provider for a given model ID.
 * Falls back to prefix-based detection if not in the registry.
 */
function resolveProvider(model: string): EmbeddingProvider {
  if (MODEL_PROVIDER_MAP[model]) return MODEL_PROVIDER_MAP[model]
  if (model.startsWith('google/') || model.startsWith('gemini-')) return 'gemini'
  return 'openrouter'
}

// ─── Client ─────────────────────────────────────────────────────────────────

export class EmbeddingClient {
  private model: string
  private dimensions: number
  private openRouterKey: string | null
  private googleAiApiKey: string | null
  private provider: EmbeddingProvider
  private cache: Map<string, Float32Array>

  constructor(config: EmbeddingClientConfig) {
    this.model = config.model
    this.dimensions = config.dimensions ?? DEFAULT_DIMENSIONS
    this.openRouterKey = config.openRouterKey ?? null
    this.googleAiApiKey = config.googleAiApiKey ?? null
    this.provider = resolveProvider(this.model)
    this.cache = new Map()
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Update the client configuration at runtime.
   * Clears the cache when the model changes (different vector space).
   */
  updateConfig(config: Partial<EmbeddingClientConfig>): void {
    if (config.model !== undefined && config.model !== this.model) {
      this.model = config.model
      this.provider = resolveProvider(this.model)
      this.clearCache()
    }
    if (config.dimensions !== undefined) this.dimensions = config.dimensions
    if (config.openRouterKey !== undefined) this.openRouterKey = config.openRouterKey || null
    if (config.googleAiApiKey !== undefined) this.googleAiApiKey = config.googleAiApiKey || null
  }

  /**
   * Check whether the required API key for the current provider is configured.
   */
  hasApiKey(): boolean {
    if (this.provider === 'gemini') {
      return this.googleAiApiKey !== null && this.googleAiApiKey.length > 0
    }
    return this.openRouterKey !== null && this.openRouterKey.length > 0
  }

  /** The current model ID. */
  getModel(): string {
    return this.model
  }

  /** The current provider. */
  getProvider(): EmbeddingProvider {
    return this.provider
  }

  /** The configured output dimensions. */
  getDimensions(): number {
    return this.dimensions
  }

  /**
   * Get a single embedding for a text string.
   * Returns a cached result if available.
   *
   * @param taskType - Hint for the embedding model. `'query'` for search queries,
   *   `'document'` for indexed content. Only affects Gemini models.
   */
  async getEmbedding(
    text: string,
    taskType: EmbeddingTaskType = 'query'
  ): Promise<Float32Array> {
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
    const embeddings = await this.callAPI([text], taskType)
    const embedding = embeddings[0]

    // Cache result
    this.cacheSet(cacheKey, embedding)

    return embedding
  }

  /**
   * Get embeddings for multiple texts in a single API call.
   * Individual texts are cached and checked before making the request.
   *
   * @param taskType - Hint for the embedding model. `'query'` for search queries,
   *   `'document'` for indexed content. Only affects Gemini models.
   */
  async getEmbeddings(
    texts: string[],
    taskType: EmbeddingTaskType = 'query'
  ): Promise<Float32Array[]> {
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
    const newEmbeddings = await this.callAPI(uncachedTexts, taskType)

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

  // ─── Private ──────────────────────────────────────────────────────────────

  /**
   * Generate a cache key from text content.
   * Includes the model name so different models don't share cache entries.
   * Uses a SHA-256 hash for long texts to keep memory usage low.
   */
  private getCacheKey(text: string): string {
    const raw = text.length <= 200 ? text : createHash('sha256').update(text).digest('hex')
    return `${this.model}:${raw}`
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
   * Route API calls to the correct provider.
   */
  private async callAPI(
    input: string[],
    taskType: EmbeddingTaskType,
    retryCount = 0
  ): Promise<Float32Array[]> {
    if (this.provider === 'gemini') {
      return this.callGeminiAPI(input, taskType, retryCount)
    }
    return this.callOpenRouterAPI(input, retryCount)
  }

  // ─── OpenRouter (OpenAI models) ───────────────────────────────────────────

  /**
   * Call the OpenRouter embeddings API.
   * Retries up to 3 times on 429 with exponential backoff.
   */
  private async callOpenRouterAPI(
    input: string[],
    retryCount = 0
  ): Promise<Float32Array[]> {
    if (!this.openRouterKey) {
      throw new Error(
        'No OpenRouter API key configured. Set it in Settings → Engine.'
      )
    }

    const response = await fetch(OPENROUTER_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.openRouterKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input,
        dimensions: this.dimensions,
      }),
    })

    if (!response.ok) {
      if (response.status === 429 && retryCount < MAX_RATE_LIMIT_RETRIES) {
        const delayMs = this.getRetryDelayMs(
          response.headers.get('retry-after'),
          retryCount
        )
        await this.delay(delayMs)
        return this.callOpenRouterAPI(input, retryCount + 1)
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

  // ─── Gemini API (Google models) ───────────────────────────────────────────

  /**
   * Call the Gemini batchEmbedContents API.
   * Retries up to 3 times on 429 with exponential backoff.
   *
   * Uses task type hints for better retrieval quality:
   * - RETRIEVAL_DOCUMENT for indexing content
   * - RETRIEVAL_QUERY for search queries
   */
  private async callGeminiAPI(
    input: string[],
    taskType: EmbeddingTaskType,
    retryCount = 0
  ): Promise<Float32Array[]> {
    if (!this.googleAiApiKey) {
      throw new Error(
        'No Google AI API key configured. Set it in Settings → Engine, or get one at ai.google.dev'
      )
    }

    // Strip the "google/" prefix for the Gemini API model name
    const geminiModelId = this.model.startsWith('google/')
      ? this.model.slice('google/'.length)
      : this.model

    const geminiTaskType =
      taskType === 'document' ? 'RETRIEVAL_DOCUMENT' : 'RETRIEVAL_QUERY'

    const url = `${GEMINI_ENDPOINT}/models/${geminiModelId}:batchEmbedContents?key=${this.googleAiApiKey}`

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: input.map((text) => ({
          model: `models/${geminiModelId}`,
          content: { parts: [{ text }] },
          taskType: geminiTaskType,
          outputDimensionality: this.dimensions,
        })),
      }),
    })

    if (!response.ok) {
      if (response.status === 429 && retryCount < MAX_RATE_LIMIT_RETRIES) {
        const delayMs = this.getRetryDelayMs(
          response.headers.get('retry-after'),
          retryCount
        )
        await this.delay(delayMs)
        return this.callGeminiAPI(input, taskType, retryCount + 1)
      }
      throw new Error(
        `Gemini API error: ${response.status} ${response.statusText}`
      )
    }

    const json = (await response.json()) as {
      embeddings: Array<{ values: number[] }>
    }

    return json.embeddings.map((e) => new Float32Array(e.values))
  }

  // ─── Utilities ────────────────────────────────────────────────────────────

  /**
   * Utility: sleep for a given duration.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private getRetryDelayMs(retryAfterHeader: string | null, retryCount: number): number {
    if (retryAfterHeader) {
      const seconds = Number.parseInt(retryAfterHeader, 10)
      if (Number.isFinite(seconds) && seconds >= 0) {
        return seconds * 1000
      }

      const retryAt = Date.parse(retryAfterHeader)
      if (!Number.isNaN(retryAt)) {
        return Math.max(0, retryAt - Date.now())
      }
    }

    return Math.min(RATE_LIMIT_DELAY_MS * Math.pow(2, retryCount), 30_000)
  }
}
