import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ─── Mock global fetch ──────────────────────────────────────────────────────

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

import { EmbeddingClient } from '../../main/services/EmbeddingClient'

/**
 * Helper: create a mock OpenRouter embedding response.
 */
function mockOpenRouterResponse(embeddings: number[][]): Response {
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
 * Helper: create a mock Gemini batchEmbedContents response.
 */
function mockGeminiResponse(embeddings: number[][]): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      embeddings: embeddings.map((values) => ({ values })),
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
    headers: {
      get: () => null,
    },
    json: async () => ({ error: { message: statusText } }),
  } as unknown as Response
}

function mockRateLimitResponse(
  statusText = 'Too Many Requests',
  retryAfter: string | null = null
): Response {
  return {
    ok: false,
    status: 429,
    statusText,
    headers: {
      get: (header: string) => (header.toLowerCase() === 'retry-after' ? retryAfter : null),
    },
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

// ─── OpenRouter Provider Tests ──────────────────────────────────────────────

describe('EmbeddingClient (OpenRouter)', () => {
  let client: EmbeddingClient

  beforeEach(() => {
    client = new EmbeddingClient({
      model: 'openai/text-embedding-3-large',
      openRouterKey: 'test-api-key',
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  // ─── API Key Management ───────────────────────────────────────────────

  describe('API key management', () => {
    it('reports hasApiKey when key is set via config', () => {
      expect(client.hasApiKey()).toBe(true)
    })

    it('reports no API key when constructed without one', () => {
      const noKeyClient = new EmbeddingClient({
        model: 'openai/text-embedding-3-large',
      })
      expect(noKeyClient.hasApiKey()).toBe(false)
    })

    it('reports no API key for empty string', () => {
      const emptyKeyClient = new EmbeddingClient({
        model: 'openai/text-embedding-3-large',
        openRouterKey: '',
      })
      expect(emptyKeyClient.hasApiKey()).toBe(false)
    })

    it('resolves provider to openrouter for OpenAI models', () => {
      expect(client.getProvider()).toBe('openrouter')
    })
  })

  // ─── getEmbedding ─────────────────────────────────────────────────────

  describe('getEmbedding', () => {
    it('returns correct 1536-dim Float32Array', async () => {
      const embedding = make1536Embedding(0.5)
      mockFetch.mockResolvedValueOnce(mockOpenRouterResponse([embedding]))

      const result = await client.getEmbedding('test text')

      expect(result).toBeInstanceOf(Float32Array)
      expect(result.length).toBe(1536)
      expect(result[0]).toBeCloseTo(0.5)
    })

    it('sends correct request to OpenRouter', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding()])
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
      const noKeyClient = new EmbeddingClient({
        model: 'openai/text-embedding-3-large',
      })

      await expect(noKeyClient.getEmbedding('test')).rejects.toThrow(
        'No OpenRouter API key configured'
      )
    })

    it('uses configured model (not hardcoded)', async () => {
      const smallClient = new EmbeddingClient({
        model: 'openai/text-embedding-3-small',
        openRouterKey: 'test-key',
      })
      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding()])
      )

      await smallClient.getEmbedding('test')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.model).toBe('openai/text-embedding-3-small')
    })
  })

  // ─── getEmbeddings (batch) ────────────────────────────────────────────

  describe('getEmbeddings', () => {
    it('returns multiple embeddings in a single API call', async () => {
      const emb1 = make1536Embedding(0.1)
      const emb2 = make1536Embedding(0.2)
      mockFetch.mockResolvedValueOnce(mockOpenRouterResponse([emb1, emb2]))

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
        mockOpenRouterResponse([make1536Embedding(0.5)])
      )
      await client.getEmbedding('text A')

      // Second call: batch with 'text A' (cached) and 'text B' (new)
      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding(0.9)])
      )
      const results = await client.getEmbeddings(['text A', 'text B'])

      expect(results).toHaveLength(2)
      expect(results[0][0]).toBeCloseTo(0.5) // from cache
      expect(results[1][0]).toBeCloseTo(0.9) // from API
      // Only the second API call should have been for 'text B'
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })

  // ─── Cache Behavior ──────────────────────────────────────────────────

  describe('caching', () => {
    it('caches results — second call does not hit API', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding(0.42)])
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
          mockOpenRouterResponse([make1536Embedding(i)])
        )
        await client.getEmbedding(`text-${i}`)
      }

      expect(mockFetch).toHaveBeenCalledTimes(50)

      // Add one more entry — should evict "text-0" (the oldest)
      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding(100)])
      )
      await client.getEmbedding('text-50')

      expect(mockFetch).toHaveBeenCalledTimes(51)

      // "text-0" should no longer be cached — requires a new API call
      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding(0)])
      )
      await client.getEmbedding('text-0')
      expect(mockFetch).toHaveBeenCalledTimes(52)

      // "text-49" should still be cached (it was the most recently used before text-50)
      await client.getEmbedding('text-49')
      expect(mockFetch).toHaveBeenCalledTimes(52) // No additional call
    })

    it('clearCache empties the cache', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding()])
      )
      await client.getEmbedding('test')

      client.clearCache()

      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding()])
      )
      await client.getEmbedding('test')

      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('clears cache when model changes via updateConfig', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding(0.42)])
      )
      await client.getEmbedding('test')
      expect(mockFetch).toHaveBeenCalledTimes(1)

      // Change model — cache should be cleared
      client.updateConfig({ model: 'openai/text-embedding-3-small' })

      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding(0.99)])
      )
      const result = await client.getEmbedding('test')
      expect(mockFetch).toHaveBeenCalledTimes(2)
      expect(result[0]).toBeCloseTo(0.99) // new value, not cached
    })
  })

  // ─── Error Handling ───────────────────────────────────────────────────

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
      vi.useFakeTimers()

      // First call: 429 rate limit
      mockFetch.mockResolvedValueOnce(
        mockRateLimitResponse()
      )
      // Retry: success
      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding(0.7)])
      )

      const promise = client.getEmbedding('test')
      await vi.runAllTimersAsync()
      const result = await promise

      expect(result[0]).toBeCloseTo(0.7)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('throws after exhausting the retry limit', async () => {
      vi.useFakeTimers()

      mockFetch.mockResolvedValue(mockRateLimitResponse())

      const promise = client.getEmbedding('test')
      const assertion = expect(promise).rejects.toThrow(
        'OpenRouter API error: 429 Too Many Requests'
      )
      await vi.runAllTimersAsync()

      await assertion
      expect(mockFetch).toHaveBeenCalledTimes(4)
    })

    it('respects Retry-After header on 429 responses', async () => {
      vi.useFakeTimers()

      mockFetch.mockResolvedValueOnce(mockRateLimitResponse('Too Many Requests', '2'))
      mockFetch.mockResolvedValueOnce(
        mockOpenRouterResponse([make1536Embedding(0.33)])
      )

      const promise = client.getEmbedding('retry-after')

      await vi.advanceTimersByTimeAsync(1999)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      const result = await promise

      expect(result[0]).toBeCloseTo(0.33)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })
  })
})

// ─── Gemini Provider Tests ──────────────────────────────────────────────────

describe('EmbeddingClient (Gemini)', () => {
  let client: EmbeddingClient

  beforeEach(() => {
    client = new EmbeddingClient({
      model: 'google/gemini-embedding-2-preview',
      googleAiApiKey: 'test-gemini-key',
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  describe('provider resolution', () => {
    it('resolves provider to gemini for google/ prefix', () => {
      expect(client.getProvider()).toBe('gemini')
    })

    it('reports hasApiKey with googleAiApiKey', () => {
      expect(client.hasApiKey()).toBe(true)
    })

    it('reports no API key when only openRouterKey is set', () => {
      const mismatchClient = new EmbeddingClient({
        model: 'google/gemini-embedding-2-preview',
        openRouterKey: 'sk-or-test',
        // no googleAiApiKey
      })
      expect(mismatchClient.hasApiKey()).toBe(false)
    })
  })

  describe('getEmbedding', () => {
    it('calls Gemini batchEmbedContents API', async () => {
      mockFetch.mockResolvedValueOnce(
        mockGeminiResponse([make1536Embedding(0.8)])
      )

      const result = await client.getEmbedding('hello world')

      expect(result).toBeInstanceOf(Float32Array)
      expect(result[0]).toBeCloseTo(0.8)

      const [url, options] = mockFetch.mock.calls[0]
      expect(url).toContain(
        'generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2-preview:batchEmbedContents'
      )
      expect(url).toContain('key=test-gemini-key')
      expect(options.method).toBe('POST')

      const body = JSON.parse(options.body)
      expect(body.requests).toHaveLength(1)
      expect(body.requests[0].model).toBe('models/gemini-embedding-2-preview')
      expect(body.requests[0].content.parts[0].text).toBe('hello world')
      expect(body.requests[0].taskType).toBe('RETRIEVAL_QUERY')
      expect(body.requests[0].outputDimensionality).toBe(1536)
    })

    it('uses RETRIEVAL_DOCUMENT task type for document embeddings', async () => {
      mockFetch.mockResolvedValueOnce(
        mockGeminiResponse([make1536Embedding()])
      )

      await client.getEmbedding('function hello() {}', 'document')

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.requests[0].taskType).toBe('RETRIEVAL_DOCUMENT')
    })

    it('throws on missing Google AI API key', async () => {
      const noKeyClient = new EmbeddingClient({
        model: 'google/gemini-embedding-2-preview',
      })

      await expect(noKeyClient.getEmbedding('test')).rejects.toThrow(
        'No Google AI API key configured'
      )
    })
  })

  describe('getEmbeddings (batch)', () => {
    it('sends batch request to Gemini API', async () => {
      const emb1 = make1536Embedding(0.3)
      const emb2 = make1536Embedding(0.6)
      mockFetch.mockResolvedValueOnce(mockGeminiResponse([emb1, emb2]))

      const results = await client.getEmbeddings(
        ['text A', 'text B'],
        'document'
      )

      expect(results).toHaveLength(2)
      expect(results[0][0]).toBeCloseTo(0.3)
      expect(results[1][0]).toBeCloseTo(0.6)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      const body = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(body.requests).toHaveLength(2)
      expect(body.requests[0].taskType).toBe('RETRIEVAL_DOCUMENT')
      expect(body.requests[1].taskType).toBe('RETRIEVAL_DOCUMENT')
    })
  })

  describe('error handling', () => {
    it('retries once on 429, then succeeds', async () => {
      vi.useFakeTimers()

      mockFetch.mockResolvedValueOnce(
        mockRateLimitResponse()
      )
      mockFetch.mockResolvedValueOnce(
        mockGeminiResponse([make1536Embedding(0.5)])
      )

      const promise = client.getEmbedding('test')
      await vi.runAllTimersAsync()
      const result = await promise

      expect(result[0]).toBeCloseTo(0.5)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('uses Retry-After header for Gemini rate limits', async () => {
      vi.useFakeTimers()

      mockFetch.mockResolvedValueOnce(mockRateLimitResponse('Too Many Requests', '3'))
      mockFetch.mockResolvedValueOnce(
        mockGeminiResponse([make1536Embedding(0.75)])
      )

      const promise = client.getEmbedding('test')
      await vi.advanceTimersByTimeAsync(2999)
      expect(mockFetch).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      const result = await promise

      expect(result[0]).toBeCloseTo(0.75)
      expect(mockFetch).toHaveBeenCalledTimes(2)
    })

    it('throws on non-retryable error', async () => {
      mockFetch.mockResolvedValueOnce(
        mockErrorResponse(403, 'Forbidden')
      )

      await expect(client.getEmbedding('test')).rejects.toThrow(
        'Gemini API error: 403 Forbidden'
      )
    })
  })
})

// ─── updateConfig Tests ─────────────────────────────────────────────────────

describe('EmbeddingClient.updateConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('switches provider when model changes to google/', () => {
    const client = new EmbeddingClient({
      model: 'openai/text-embedding-3-small',
      openRouterKey: 'test-key',
    })

    expect(client.getProvider()).toBe('openrouter')

    client.updateConfig({
      model: 'google/gemini-embedding-2-preview',
      googleAiApiKey: 'gemini-key',
    })

    expect(client.getProvider()).toBe('gemini')
    expect(client.getModel()).toBe('google/gemini-embedding-2-preview')
    expect(client.hasApiKey()).toBe(true)
  })

  it('does not clear cache when only API key changes', async () => {
    const client = new EmbeddingClient({
      model: 'openai/text-embedding-3-small',
      openRouterKey: 'key-1',
    })

    mockFetch.mockResolvedValueOnce(
      mockOpenRouterResponse([make1536Embedding(0.42)])
    )
    await client.getEmbedding('cached')

    // Change API key but not model
    client.updateConfig({ openRouterKey: 'key-2' })

    // Should still be cached
    const result = await client.getEmbedding('cached')
    expect(result[0]).toBeCloseTo(0.42)
    expect(mockFetch).toHaveBeenCalledTimes(1)
  })

  it('respects custom dimensions', () => {
    const client = new EmbeddingClient({
      model: 'google/gemini-embedding-2-preview',
      dimensions: 768,
      googleAiApiKey: 'test-key',
    })

    expect(client.getDimensions()).toBe(768)
  })
})
