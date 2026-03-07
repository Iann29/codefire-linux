import type {
  ProviderAdapter,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  ProviderHealth,
} from './BaseProvider'

export class CustomEndpointAdapter implements ProviderAdapter {
  readonly id = 'custom'
  readonly name = 'Custom Endpoint'

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/chat/completions`

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        temperature: request.temperature,
        max_tokens: request.maxTokens ?? 4096,
      }),
      signal: request.signal,
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => `HTTP ${response.status}`)
      throw new Error(`Custom endpoint error (${url}): ${errorText.slice(0, 400)}`)
    }

    return (await response.json()) as ChatCompletionResponse
  }

  async listModels(): Promise<ModelInfo[]> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}/models`
    const headers: Record<string, string> = {}
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`
    }

    try {
      const response = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) return []

      const data = (await response.json()) as { data?: Array<{ id: string; name?: string }> }
      if (!Array.isArray(data.data)) return []

      return data.data.map((m) => ({
        id: m.id,
        name: m.name || m.id,
      }))
    } catch {
      return []
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now()
    try {
      const url = `${this.baseUrl.replace(/\/+$/, '')}/models`
      const headers: Record<string, string> = {}
      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`
      }
      const res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      })
      return { ok: res.ok, latencyMs: Date.now() - start, error: res.ok ? undefined : `HTTP ${res.status}` }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message }
    }
  }
}
