import type {
  ProviderAdapter,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  ProviderHealth,
} from './BaseProvider'
import { openaiToAnthropic, anthropicToOpenai } from './format-translators'
import { KIMI_CONFIG } from './oauth-configs'

const PROVIDER_ID = 'kimi-subscription'

/**
 * Kimi (Moonshot) adapter.
 * Uses Anthropic Messages API format with API key authentication.
 * Requires header `User-Agent: claude-code/1.0`.
 */
export class KimiAdapter implements ProviderAdapter {
  readonly id = PROVIDER_ID
  readonly name = 'Kimi'

  constructor(private readonly apiKey: string) {}

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    if (!this.apiKey) throw new Error('Kimi API key not configured in Settings > Engine.')

    const anthropicRequest = openaiToAnthropic(request)

    const res = await fetch(`${KIMI_CONFIG.apiBaseUrl}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'User-Agent': KIMI_CONFIG.userAgent ?? 'claude-code/1.0',
        'anthropic-version': '2024-10-22',
      },
      body: JSON.stringify(anthropicRequest),
      signal: request.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`)
      throw new Error(`Kimi API error: ${text.slice(0, 400)}`)
    }

    const anthropicResponse = await res.json()
    return anthropicToOpenai(anthropicResponse)
  }

  async listModels(): Promise<ModelInfo[]> {
    return [
      { id: 'kimi-k2.5', name: 'Kimi K2.5' },
      { id: 'kimi-k2', name: 'Kimi K2' },
    ]
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.apiKey) return { ok: false, error: 'No API key configured' }

    const start = Date.now()
    try {
      const res = await fetch(`${KIMI_CONFIG.apiBaseUrl}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'User-Agent': KIMI_CONFIG.userAgent ?? 'claude-code/1.0',
          'anthropic-version': '2024-10-22',
        },
        body: JSON.stringify({
          model: 'kimi-k2.5',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(10_000),
      })
      // 400 means API is reachable but request may be malformed — still healthy
      return { ok: res.ok || res.status === 400, latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message }
    }
  }
}
