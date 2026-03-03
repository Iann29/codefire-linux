import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ─── Mock global fetch ──────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { EmbeddingClient } from '../../main/services/EmbeddingClient'

/**
 * Helper: create a mock embedding response from OpenRouter.
 */
function mockEmbeddingResponse(embeddings: number[][]): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      data: embeddings.map((embedding) => ({ embedding })),
    }),
  } as unknown as Response
}

/**
 * Helper: create a mock error response.
 */
function mockErrorResponse(status: number, statusText: string): Response {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({ error: { message: statusText } }),
  } as unknown as Response
}

/**
 * Helper: create a 1536-dimension embedding (all zeros except first value).
 */
function make1536Embedding(firstValue = 1.0): number[] {
  const arr = new Array(1536).fill(0)
  arr[0] = firstValue
  return arr
}

describe('EmbeddingClient', () => {
  let client: EmbeddingClient

  beforeEach(() => {
    client = new EmbeddingClient('test-api-key')
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ─── API Key Management ─────────────────────────────────────────────────

  describe('API key management', () => {
    it('reports hasApiKey when key is set via constructor', () => {
      expect(client.hasApiKey()).toBe(true)
    })

    it('reports no API key when constructed without one', () => {
      const noKeyClient = new EmbeddingClient()
      expect(noKeyClient.hasApiKey()).toBe(false)
    })

    it('allows setting API key after construction', () => {
      const noKeyClient = new EmbeddingClient()
      expect(noKeyClient.hasApiKey()).toBe(false)

      noKeyClient.setApiKey('new-key')
      expect(noKeyClient.hasApiKey()).toBe(true)
    })

    it('reports no API key for empty string', () => {
      const emptyKeyClient = new EmbeddingClient('')
      expect(emptyKeyClient.hasApiKey()).toBe(false)
    })
  })

  // ─── getEmbedding ───────────────────────────────────────────────────────

  describe('getEmbedding', () => {
    it('returns correct 1536-dim Float32Array', async () => {
      const embedding = make1536Embedding(0.5)
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([embedding]))

      const result = await client.getEmbedding('test text')

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(1536)
      expect(result[0]).toBeCloseTo(0.5)
    })

    it('sends correct request to OpenRouter', async () => {
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([make1536Embedding()])
      )

      await client.getEmbedding('hello world')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toBe('https://openrouter.ai/api/v1/embeddings')
      expect(options.method).toBe('POST')
      expect(options.headers).toEqual({
        Authorization: 'Bearer test-api-key',
        'Content-Type': 'application/json',
      })

      const body = JSON.parse(options.body)
      expect(body.model).toBe('openai/text-embedding-3-large')
      expect(body.input).toEqual(['hello world'])
      expect(body.dimensions).toBe(1536)
    })

    it('throws on missing API key', async () => {
      const noKeyClient = new EmbeddingClient()

      await expect(noKeyClient.getEmbedding('test')).rejects.toThrow(
        'No API key configured'
      )
    })
  })

  // ─── getEmbeddings (batch) ──────────────────────────────────────────────

  describe('getEmbeddings', () => {
    it('returns multiple embeddings in a single API call', async () => {
      const emb1 = make1536Embedding(0.1)
      const emb2 = make1536Embedding(0.2)
      mockFetch.mockResolvedValueOnce(mockEmbeddingResponse([emb1, emb2]))

      const results = await client.getEmbeddings(['text 1', 'text 2'])

      expect(results).toHaveLength(2)
      expect(results[0][0]).toBeCloseTo(0.1)
      expect(results[1][0]).toBeCloseTo(0.2)
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })

    it('returns empty array for empty input', async () => {
      const results = await client.getEmbeddings([])
      expect(results).toEqual([])
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('uses cache for previously fetched texts', async () => {
      // First call: fetch embedding for 'text A'
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([make1536Embedding(0.5)])
      )
      await client.getEmbedding('text A')

      // Second call: batch with 'text A' (cached) and 'text B' (new)
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([make1536Embedding(0.9)])
      )
      const results = await client.getEmbeddings(['text A', 'text B'])

      expect(results).toHaveLength(2)
      expect(results[0][0]).toBeCloseTo(0.5) // from cache
      expect(results[1][0]).toBeCloseTo(0.9) // from API
      // Only the second API call should have been for 'text B'
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // ─── Cache Behavior ────────────────────────────────────────────────────

  describe('caching', () => {
    it('caches results — second call does not hit API', async () => {
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([make1536Embedding(0.42)])
      )

      const first = await client.getEmbedding('cached text')
      const second = await client.getEmbedding('cached text')

      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(first[0]).toBeCloseTo(0.42)
      expect(second[0]).toBeCloseTo(0.42)
    })

    it('evicts oldest entry when cache exceeds 50', async () => {
      // Fill cache with 50 entries
      for (let i = 0; i < 50; i++) {
        mockFetch.mockResolvedValueOnce(
          mockEmbeddingResponse([make1536Embedding(i)])
        )
        await client.getEmbedding(`text-${i}`)
      }

      expect(mockFetch).toHaveBeenCalledTimes(50)

      // Add one more entry — should evict "text-0" (the oldest)
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([make1536Embedding(100)])
      )
      await client.getEmbedding('text-50')

      expect(mockFetch).toHaveBeenCalledTimes(51)

      // "text-0" should no longer be cached — requires a new API call
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([make1536Embedding(0)])
      )
      await client.getEmbedding('text-0')
      expect(mockFetch).toHaveBeenCalledTimes(52)

      // "text-49" should still be cached (it was the most recently used before text-50)
      await client.getEmbedding('text-49')
      expect(mockFetch).toHaveBeenCalledTimes(52) // No additional call
    })

    it('clearCache empties the cache', async () => {
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([make1536Embedding()])
      )
      await client.getEmbedding('test')

      client.clearCache()

      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([make1536Embedding()])
      )
      await client.getEmbedding('test')

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // ─── Error Handling ─────────────────────────────────────────────────────

  describe('error handling', () => {
    it('throws on 401 unauthorized', async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(401, 'Unauthorized')
      )

      await expect(client.getEmbedding('test')).rejects.toThrow(
        'OpenRouter API error: 401 Unauthorized'
      )
    })

    it('throws on 500 server error', async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(500, 'Internal Server Error')
      )

      await expect(client.getEmbedding('test')).rejects.toThrow(
        'OpenRouter API error: 500 Internal Server Error'
      )
    })

    it('retries once on 429 rate limit, then succeeds', async () => {
      // First call: 429 rate limit
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(429, 'Too Many Requests')
      )
      // Retry: success
      mockFetch.mockResolvedValueOnce(
        mockEmbeddingResponse([make1536Embedding(0.7)])
      )

      const result = await client.getEmbedding('test')

      expect(result[0]).toBeCloseTo(0.7)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('throws after second 429 (does not retry infinitely)', async () => {
      // First call: 429
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(429, 'Too Many Requests')
      )
      // Retry: 429 again
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(429, 'Too Many Requests')
      )

      await expect(client.getEmbedding('test')).rejects.toThrow(
        'OpenRouter API error: 429 Too Many Requests'
      )
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })
})
