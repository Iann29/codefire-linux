import type { AppConfig } from '@shared/models'
import type {
  ProviderAdapter,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelInfo,
  ProviderHealth,
} from './BaseProvider'
import { OpenRouterAdapter } from './OpenRouterAdapter'
import { CustomEndpointAdapter } from './CustomEndpointAdapter'
import type { OAuthEngine } from './OAuthEngine'

export type ProviderType = AppConfig['aiProvider']

const SUBSCRIPTION_PROVIDERS = new Set([
  'claude-subscription',
  'openai-subscription',
  'gemini-subscription',
  'kimi-subscription',
])

export class ProviderRouter {
  private cachedProvider: ProviderAdapter | null = null
  private cachedProviderKey = ''
  private oauthEngine: OAuthEngine | null = null

  setOAuthEngine(engine: OAuthEngine): void {
    this.oauthEngine = engine
  }

  resolveProvider(config: AppConfig, overrides?: { apiKey?: string }): ProviderAdapter {
    const providerType = config.aiProvider || 'openrouter'
    const cacheKey = this.buildCacheKey(providerType, config, overrides)

    if (this.cachedProvider && this.cachedProviderKey === cacheKey) {
      return this.cachedProvider
    }

    let provider: ProviderAdapter

    switch (providerType) {
      case 'custom': {
        const baseUrl = config.customEndpointUrl
        if (!baseUrl) throw new Error('Custom endpoint URL not configured in Settings > Engine.')
        provider = new CustomEndpointAdapter(baseUrl, config.customEndpointKey || '')
        break
      }

      case 'claude-subscription':
      case 'openai-subscription':
      case 'gemini-subscription':
      case 'kimi-subscription':
        // Subscription adapters will be implemented in Phase 3.
        // For now, check that OAuth is connected and give a clear error.
        throw new Error(
          `Subscription provider "${providerType}" is not yet available. ` +
          'This will be enabled in a future update. Please use OpenRouter or Custom Endpoint.'
        )

      case 'openrouter':
      default: {
        const apiKey = overrides?.apiKey || config.openRouterKey
        if (!apiKey) throw new Error('OpenRouter API key not configured in Settings > Engine.')
        provider = new OpenRouterAdapter(apiKey)
        break
      }
    }

    this.cachedProvider = provider
    this.cachedProviderKey = cacheKey
    return provider
  }

  async chatCompletion(
    config: AppConfig,
    request: ChatCompletionRequest,
    overrides?: { apiKey?: string }
  ): Promise<ChatCompletionResponse> {
    const provider = this.resolveProvider(config, overrides)
    return provider.chatCompletion(request)
  }

  async listModels(config: AppConfig): Promise<ModelInfo[]> {
    try {
      const provider = this.resolveProvider(config)
      return await provider.listModels()
    } catch {
      return []
    }
  }

  async healthCheck(config: AppConfig): Promise<ProviderHealth> {
    try {
      const provider = this.resolveProvider(config)
      return await provider.healthCheck()
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  private buildCacheKey(
    providerType: string,
    config: AppConfig,
    overrides?: { apiKey?: string }
  ): string {
    const parts = [providerType]
    if (providerType === 'openrouter') {
      parts.push(overrides?.apiKey || config.openRouterKey || '')
    } else if (providerType === 'custom') {
      parts.push(config.customEndpointUrl || '', config.customEndpointKey || '')
    } else if (SUBSCRIPTION_PROVIDERS.has(providerType)) {
      parts.push(providerType)
    }
    return parts.join('::')
  }
}
