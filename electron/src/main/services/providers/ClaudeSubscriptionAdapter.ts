import {
  ProviderHttpError,
  type ProviderAdapter,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ModelInfo,
  type ProviderHealth,
} from './BaseProvider'
import type { OAuthEngine } from './OAuthEngine'
import { openaiToAnthropic, anthropicToOpenai } from './format-translators'
import { CLAUDE_OAUTH } from './oauth-configs'

const PROVIDER_ID = 'claude-subscription'
const API_VERSION = '2024-10-22'

/** Headers required for Claude Max subscription tokens (OAuth-derived / setup-token) */
const SUBSCRIPTION_HEADERS: Record<string, string> = {
  'anthropic-beta': 'oauth-2025-04-20',
  'user-agent': 'claude-cli/2.1.71',
}

export class ClaudeSubscriptionAdapter implements ProviderAdapter {
  readonly id = PROVIDER_ID
  readonly name = 'Claude (Subscription)'
  readonly accountIndex: number

  constructor(private readonly oauthEngine: OAuthEngine, accountIndex: number = 0) {
    this.accountIndex = accountIndex
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID, this.accountIndex)
    if (!token) throw new Error('Claude subscription not connected. Run "claude setup-token" and paste the token in Settings > Engine.')

    const anthropicRequest = openaiToAnthropic(request)

    const res = await fetch(`${CLAUDE_OAUTH.apiBaseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'anthropic-version': API_VERSION,
        ...SUBSCRIPTION_HEADERS,
      },
      body: JSON.stringify(anthropicRequest),
      signal: request.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`)
      throw new ProviderHttpError(
        `Claude API error: ${text.slice(0, 400)}`,
        res.status,
        res.headers,
      )
    }

    const anthropicResponse = await res.json()
    return anthropicToOpenai(anthropicResponse)
  }

  async listModels(): Promise<ModelInfo[]> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID, this.accountIndex)
    if (!token) return []

    return [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-haiku-4-20250414', name: 'Claude Haiku 4' },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4' },
    ]
  }

  async healthCheck(): Promise<ProviderHealth> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID, this.accountIndex)
    if (!token) return { ok: false, error: 'Not connected' }

    const start = Date.now()
    try {
      const res = await fetch(`${CLAUDE_OAUTH.apiBaseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'anthropic-version': API_VERSION,
          ...SUBSCRIPTION_HEADERS,
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-20250414',
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        signal: AbortSignal.timeout(10_000),
      })
      return { ok: res.ok || res.status === 400, latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message }
    }
  }
}
