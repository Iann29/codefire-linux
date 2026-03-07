import type {
  ProviderAdapter,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  ProviderHealth,
} from './BaseProvider'
import type { OAuthEngine } from './OAuthEngine'
import { openaiToGemini, geminiToOpenai, stripProviderPrefix } from './format-translators'
import { GEMINI_OAUTH } from './oauth-configs'

const PROVIDER_ID = 'gemini-subscription'

export class GeminiSubscriptionAdapter implements ProviderAdapter {
  readonly id = PROVIDER_ID
  readonly name = 'Gemini (Subscription)'

  constructor(private readonly oauthEngine: OAuthEngine) {}

  async chatCompletion(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID)
    if (!token) throw new Error('Gemini subscription not connected. Please sign in via Settings > Engine.')

    const model = stripProviderPrefix(request.model)
    const geminiRequest = openaiToGemini(request)

    const url = `${GEMINI_OAUTH.apiBaseUrl}/v1beta/models/${model}:generateContent`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(geminiRequest),
      signal: request.signal,
    })

    if (!res.ok) {
      const text = await res.text().catch(() => `HTTP ${res.status}`)
      throw new Error(`Gemini API error: ${text.slice(0, 400)}`)
    }

    const geminiResponse = await res.json()
    return geminiToOpenai(geminiResponse)
  }

  async listModels(): Promise<ModelInfo[]> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID)
    if (!token) return []

    try {
      const res = await fetch(`${GEMINI_OAUTH.apiBaseUrl}/v1beta/models`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })

      if (!res.ok) return this.defaultModels()

      const json = (await res.json()) as {
        models?: Array<{ name: string; displayName: string; supportedGenerationMethods?: string[] }>
      }

      if (!json.models?.length) return this.defaultModels()

      return json.models
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => ({
          id: m.name.replace('models/', ''),
          name: m.displayName,
        }))
        .slice(0, 20)
    } catch {
      return this.defaultModels()
    }
  }

  async healthCheck(): Promise<ProviderHealth> {
    const token = await this.oauthEngine.getValidToken(PROVIDER_ID)
    if (!token) return { ok: false, error: 'Not connected' }

    const start = Date.now()
    try {
      const res = await fetch(`${GEMINI_OAUTH.apiBaseUrl}/v1beta/models`, {
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
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    ]
  }
}
