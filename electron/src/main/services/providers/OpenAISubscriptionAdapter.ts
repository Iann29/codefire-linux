import {
  ProviderHttpError,
  type ProviderAdapter,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ModelInfo,
  type ProviderHealth,
} from './BaseProvider'
import type { OAuthEngine } from './OAuthEngine'
import { OPENAI_OAUTH } from './oauth-configs'

const PROVIDER_ID = 'openai-subscription'

export class OpenAISubscriptionAdapter implements ProviderAdapter {
  readonly id = PROVIDER_ID
  readonly name = 'ChatGPT (Subscription)'
  readonly accountIndex: number

  constructor(private readonly oauthEngine: OAuthEngine, accountIndex: number = 0) {
    this.accountIndex = accountIndex
  }

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID, this.accountIndex)
    if (!token) throw new Error('OpenAI subscription not connected. Please sign in via Settings > Engine.')

    // OpenAI format is our internal format — minimal translation
    const res = await fetch(`${OPENAI_OAUTH.apiBaseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        model: stripPrefix(request.model),
        messages: request.messages,
        tools: request.tools,
        temperature: request.temperature,
        max_tokens: request.maxTokens ?? 4096,
      }),
      signal: request.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`)
      throw new ProviderHttpError(
        `OpenAI API error: ${text.slice(0, 400)}`,
        res.status,
        res.headers,
      )
    }

    return (await res.json()) as ChatCompletionResponse
  }

  async listModels(): Promise<ModelInfo[]> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID, this.accountIndex)
    if (!token) return []

    try {
      const res = await fetch(`${OPENAI_OAUTH.apiBaseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) return this.defaultModels()

      const json = (await res.json()) as { data?: Array<{ id: string }> }
      if (!json.data?.length) return this.defaultModels()

      // Filter to chat models only
      const chatModels = json.data
        .filter((m) => m.id.startsWith('gpt-') || m.id.startsWith('o') || m.id.startsWith('chatgpt-'))
        .slice(0, 20)
        .map((m) => ({ id: m.id, name: m.id }))

      return chatModels.length > 0 ? chatModels : this.defaultModels()
    } catch {
      return this.defaultModels()
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID, this.accountIndex)
    if (!token) return { ok: false, error: 'Not connected' }

    const start = Date.now()
    try {
      const res = await fetch(`${OPENAI_OAUTH.apiBaseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
      return { ok: res.ok, latencyMs: Date.now() - start }
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: (err as Error).message }
    }
  }

  private defaultModels(): ModelInfo[] {
    return [
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'o3', name: 'o3' },
      { id: 'o4-mini', name: 'o4-mini' },
    ]
  }
}

function stripPrefix(model: string): string {
  const slash = model.indexOf('/')
  return slash >= 0 ? model.slice(slash + 1) : model
}
