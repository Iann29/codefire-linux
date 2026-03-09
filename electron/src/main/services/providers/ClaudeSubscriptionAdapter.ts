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
const API_VERSION = '2023-06-01'

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

  async streamChatCompletion(
    request: ChatCompletionRequest,
    onChunk: (text: string) => void,
  ): Promise<{
    content: string
    usage?: {
      prompt_tokens: number
      completion_tokens: number
      total_tokens?: number
      cache_read_tokens?: number
      cache_write_tokens?: number
      source?: 'provider'
    }
  }> {
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
      body: JSON.stringify({ ...anthropicRequest, stream: true }),
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

    if (!res.body) throw new Error('No response body for streaming')

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullContent = ''
    let inputTokens = 0
    let outputTokens = 0
    let cacheReadTokens = 0
    let cacheWriteTokens = 0
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue

          try {
            const parsed = JSON.parse(data)

            if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
              const text = parsed.delta.text ?? ''
              fullContent += text
              onChunk(text)
            } else if (parsed.type === 'message_delta' && parsed.usage) {
              outputTokens = parsed.usage.output_tokens ?? outputTokens
            } else if (parsed.type === 'message_start' && parsed.message?.usage) {
              inputTokens = parsed.message.usage.input_tokens ?? inputTokens
              cacheReadTokens = parsed.message.usage.cache_read_input_tokens ?? cacheReadTokens
              cacheWriteTokens = parsed.message.usage.cache_creation_input_tokens ?? cacheWriteTokens
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
    } finally {
      reader.releaseLock()
    }

    const usage = (inputTokens || outputTokens)
      ? {
        prompt_tokens: inputTokens,
        completion_tokens: outputTokens,
        total_tokens: inputTokens + outputTokens,
        cache_read_tokens: cacheReadTokens,
        cache_write_tokens: cacheWriteTokens,
        source: 'provider' as const,
      }
      : undefined

    return { content: fullContent, usage }
  }

  async listModels(): Promise<ModelInfo[]> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID, this.accountIndex)
    if (!token) return []

    return [
      { id: 'claude-opus-4-6', name: 'Claude Opus 4.6' },
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
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
          model: 'claude-haiku-4-5-20251001',
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
