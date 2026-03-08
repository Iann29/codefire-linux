import {
  ProviderHttpError,
  type ProviderAdapter,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ModelInfo,
  type ProviderHealth,
} from './BaseProvider'

export class OpenRouterAdapter implements ProviderAdapter {
  readonly id = 'openrouter'
  readonly name = 'OpenRouter'

  constructor(private readonly apiKey: string) {}

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'X-Title': 'Pinyino',
      },
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
      throw new ProviderHttpError(
        `OpenRouter API error: ${errorText.slice(0, 400)}`,
        response.status,
        response.headers,
      )
    }

    return (await response.json()) as ChatCompletionResponse
  }

  async listModels(): Promise<ModelInfo[]> {
    // OpenRouter has hundreds of models; return a curated default list
    return [
      { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6' },
      { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'anthropic/claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
      { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro' },
      { id: 'google/gemini-3-flash-preview', name: 'Gemini 3 Flash' },
      { id: 'openai/gpt-5.4', name: 'GPT-5.4' },
      { id: 'deepseek/deepseek-v3.2', name: 'DeepSeek V3.2' },
      { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5' },
    ]
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.apiKey) return { ok: false, error: 'No API key configured' }
    const start = Date.now()
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      })
      return { ok: res.ok, latencyMs: Date.now() - start, error: res.ok ? undefined : `HTTP ${res.status}` }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message }
    }
  }
}
