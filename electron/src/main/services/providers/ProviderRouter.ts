import { BrowserWindow } from 'electron'
import type { AppConfig, RateLimitInfo, ModelRoutingRule, ProviderModelGroup, AIProviderType } from '@shared/models'
import {
  ProviderHttpError,
  type ProviderAdapter,
  type ChatCompletionRequest,
  type ChatCompletionResponse,
  type ModelInfo,
  type ProviderHealth,
} from './BaseProvider'
import { OpenRouterAdapter } from './OpenRouterAdapter'
import { CustomEndpointAdapter } from './CustomEndpointAdapter'
import { ClaudeSubscriptionAdapter } from './ClaudeSubscriptionAdapter'
import { OpenAISubscriptionAdapter } from './OpenAISubscriptionAdapter'
import { GeminiSubscriptionAdapter } from './GeminiSubscriptionAdapter'
import { KimiAdapter } from './KimiAdapter'
import type { OAuthEngine } from './OAuthEngine'
import type { TokenStore } from './TokenStore'

export type ProviderType = AppConfig['aiProvider']

const SUBSCRIPTION_PROVIDERS = new Set([
  'claude-subscription',
  'openai-subscription',
  'gemini-subscription',
  'kimi-subscription',
])

// Human-readable names for providers
const PROVIDER_NAMES: Record<string, string> = {
  openrouter: 'OpenRouter',
  custom: 'Custom Endpoint',
  'claude-subscription': 'Claude Max',
  'openai-subscription': 'ChatGPT Plus',
  'gemini-subscription': 'Gemini',
  'kimi-subscription': 'Kimi',
}

// ─── Circuit Breaker Types ──────────────────────────────────────────────────

interface CircuitState {
  failures: number
  openUntil: number
}

// ─── ProviderRouter ─────────────────────────────────────────────────────────

export class ProviderRouter {
  private cachedProvider: ProviderAdapter | null = null
  private cachedProviderKey = ''
  private oauthEngine: OAuthEngine | null = null
  private tokenStore: TokenStore | null = null

  // Circuit breaker state per provider id (includes per-account keys like "claude-subscription::1")
  private circuitState = new Map<string, CircuitState>()
  private static readonly CIRCUIT_THRESHOLD = 5
  private static readonly CIRCUIT_COOLDOWN_MS = 2 * 60 * 1000 // 2 minutes

  // Rate limit state per provider id
  private rateLimitState = new Map<string, RateLimitInfo>()
  private rateLimitTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // Round-robin counters per provider type
  private roundRobinCounters = new Map<string, number>()

  setOAuthEngine(engine: OAuthEngine): void {
    this.oauthEngine = engine
  }

  setTokenStore(store: TokenStore): void {
    this.tokenStore = store
  }

  // ─── Round-Robin ─────────────────────────────────────────────────────────

  /**
   * Get the next account index for a provider using round-robin.
   * Skips accounts whose per-account circuit is open.
   * Returns 0 if only one account exists or none are available.
   */
  getNextAccountIndex(providerId: string): number {
    if (!this.tokenStore) return 0

    const accountCount = this.tokenStore.getAccountCount(providerId)
    if (accountCount <= 1) return 0

    const currentCounter = this.roundRobinCounters.get(providerId) ?? 0

    // Try each account starting from the next one in the rotation
    for (let i = 0; i < accountCount; i++) {
      const candidateIndex = (currentCounter + i) % accountCount
      const accountCircuitKey = `${providerId}::${candidateIndex}`

      if (!this.isCircuitOpen(accountCircuitKey)) {
        // Found a non-rate-limited account — advance counter past it
        this.roundRobinCounters.set(providerId, (candidateIndex + 1) % accountCount)
        console.log(
          `[ProviderRouter] Round-robin ${providerId}: selected account ${candidateIndex} of ${accountCount}`
        )
        return candidateIndex
      }
    }

    // All accounts are rate-limited — fall through to default (0)
    // The caller should handle fallback to OpenRouter
    console.log(
      `[ProviderRouter] Round-robin ${providerId}: ALL ${accountCount} accounts rate-limited`
    )
    this.roundRobinCounters.set(providerId, (currentCounter + 1) % accountCount)
    return currentCounter % accountCount
  }

  resolveProvider(config: AppConfig, overrides?: { apiKey?: string }): ProviderAdapter {
    const providerType = config.aiProvider || 'openrouter'

    // For subscription providers, use round-robin to pick an account index
    let accountIndex = 0
    if (SUBSCRIPTION_PROVIDERS.has(providerType)) {
      accountIndex = this.getNextAccountIndex(providerType)
    }

    const cacheKey = this.buildCacheKey(providerType, config, overrides, accountIndex)

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

      case 'claude-subscription': {
        if (!this.oauthEngine) throw new Error('OAuth engine not initialized.')
        provider = new ClaudeSubscriptionAdapter(this.oauthEngine, accountIndex)
        break
      }

      case 'openai-subscription': {
        if (!this.oauthEngine) throw new Error('OAuth engine not initialized.')
        provider = new OpenAISubscriptionAdapter(this.oauthEngine, accountIndex)
        break
      }

      case 'gemini-subscription': {
        if (!this.oauthEngine) throw new Error('OAuth engine not initialized.')
        provider = new GeminiSubscriptionAdapter(this.oauthEngine, accountIndex)
        break
      }

      case 'kimi-subscription': {
        const kimiKey = overrides?.apiKey || config.customEndpointKey
        if (!kimiKey) throw new Error('Kimi API key not configured in Settings > Engine.')
        provider = new KimiAdapter(kimiKey)
        break
      }

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

  /**
   * Resolve provider based on model routing rules.
   * Iterates config.modelRouting and matches model ID against each rule's pattern.
   * If a rule matches, resolves the provider indicated by the rule.
   * If no rule matches, falls back to the default provider (config.aiProvider).
   */
  resolveProviderForModel(
    config: AppConfig,
    model: string,
    overrides?: { apiKey?: string }
  ): ProviderAdapter {
    // 1. Check explicit model routing rules first
    const rules = config.modelRouting
    if (rules && rules.length > 0 && model) {
      for (const rule of rules) {
        if (this.matchesRoutingPattern(rule.pattern, model)) {
          const routedConfig = { ...config, aiProvider: rule.provider }
          console.log(
            `[ProviderRouter] Model routing: "${model}" matched pattern "${rule.pattern}" -> ${rule.provider} (${rule.label})`
          )
          return this.resolveProvider(routedConfig, overrides)
        }
      }
    }

    // 2. Auto-detect provider from model ID (prevents sending wrong models to wrong providers)
    if (model) {
      const detected = this.detectProviderForModel(model, config)
      if (detected && detected !== config.aiProvider) {
        const routedConfig = { ...config, aiProvider: detected }
        console.log(
          `[ProviderRouter] Auto-routing model "${model}" -> ${detected} (detected from model ID)`
        )
        return this.resolveProvider(routedConfig, overrides)
      }
    }

    // 3. Fallback to default provider
    return this.resolveProvider(config, overrides)
  }

  /**
   * Detect which provider a model belongs to based on its ID pattern.
   * - Models with "/" prefix (e.g. "openai/gpt-5.4") -> openrouter
   * - "claude-*" -> claude-subscription (if connected)
   * - "gpt-*", "o3*", "o4-*", "chatgpt-*" -> openai-subscription (if connected)
   * - "gemini-*" -> gemini-subscription (if connected)
   * - "kimi-*" -> kimi-subscription (if connected)
   * Returns null if unable to detect or if the model matches the default provider.
   */
  private detectProviderForModel(model: string, config: AppConfig): AIProviderType | null {
    const m = model.toLowerCase()

    // Prefixed models (e.g. "openai/gpt-5.4", "anthropic/claude-opus-4-6") -> OpenRouter
    if (model.includes('/')) {
      if (config.openRouterKey) return 'openrouter'
      return null
    }

    // Claude models
    if (m.startsWith('claude-')) {
      if (this.isProviderConnected('claude-subscription', config)) return 'claude-subscription'
      if (config.openRouterKey) return 'openrouter'
      return null
    }

    // OpenAI models
    if (m.startsWith('gpt-') || m === 'o3' || m.startsWith('o3-') || m.startsWith('o4-') || m.startsWith('chatgpt-')) {
      if (this.isProviderConnected('openai-subscription', config)) return 'openai-subscription'
      if (config.openRouterKey) return 'openrouter'
      return null
    }

    // Gemini models
    if (m.startsWith('gemini-')) {
      if (this.isProviderConnected('gemini-subscription', config)) return 'gemini-subscription'
      if (config.openRouterKey) return 'openrouter'
      return null
    }

    // Kimi models
    if (m.startsWith('kimi-')) {
      if (this.isProviderConnected('kimi-subscription', config)) return 'kimi-subscription'
      if (config.openRouterKey) return 'openrouter'
      return null
    }

    return null
  }

  /** Check if a subscription provider has credentials available */
  private isProviderConnected(providerId: string, config: AppConfig): boolean {
    if (SUBSCRIPTION_PROVIDERS.has(providerId)) {
      if (providerId === 'kimi-subscription') {
        return (this.tokenStore?.getAccountCount(providerId) ?? 0) > 0 || !!config.customEndpointKey
      }
      return (this.tokenStore?.getAccountCount(providerId) ?? 0) > 0
    }
    if (providerId === 'openrouter') return !!config.openRouterKey
    if (providerId === 'custom') return !!config.customEndpointUrl
    return false
  }

  /**
   * Simple pattern matching for model routing rules.
   * - Pattern ending with "*": prefix match (e.g. "claude-opus*" matches "claude-opus-4")
   * - Pattern containing "*" in the middle: splits on * and checks startsWith + endsWith
   * - Pattern without "*": exact match
   * All comparisons are case-insensitive.
   */
  private matchesRoutingPattern(pattern: string, model: string): boolean {
    const p = pattern.toLowerCase().trim()
    const m = model.toLowerCase().trim()

    if (!p) return false

    if (p.endsWith('*') && !p.slice(0, -1).includes('*')) {
      // Prefix match: "claude-opus*" matches "claude-opus-4-6"
      return m.startsWith(p.slice(0, -1))
    }

    if (p.includes('*')) {
      // Wildcard in middle: "gpt-*-mini" matches "gpt-4o-mini"
      const parts = p.split('*')
      if (parts.length === 2) {
        return m.startsWith(parts[0]) && m.endsWith(parts[1])
      }
      // Multiple wildcards: treat as contains for each segment
      let pos = 0
      for (const part of parts) {
        if (!part) continue
        const idx = m.indexOf(part, pos)
        if (idx === -1) return false
        pos = idx + part.length
      }
      return true
    }

    // Exact match
    return m === p
  }

  async chatCompletion(
    config: AppConfig,
    request: ChatCompletionRequest,
    overrides?: { apiKey?: string }
  ): Promise<ChatCompletionResponse> {
    const primary = this.resolveProviderForModel(config, request.model, overrides)
    const primaryTrackingKey = this.getTrackingKey(primary)

    // If the primary provider's circuit is open, try fallback first
    if (this.isCircuitOpen(primaryTrackingKey)) {
      const fallback = this.resolveFallback(config, primary.id, overrides)
      if (fallback) {
        console.log(
          `[ProviderRouter] Circuit open for ${primaryTrackingKey} — using fallback ${fallback.id}`
        )
        return this.executeWithTracking(fallback, request)
      }
      // No fallback available — try primary anyway (half-open probe)
      console.log(
        `[ProviderRouter] Circuit open for ${primaryTrackingKey}, no fallback — attempting half-open probe`
      )
    }

    try {
      const response = await this.executeWithTracking(primary, request)
      this.recordSuccess(primaryTrackingKey)
      return response
    } catch (err) {
      // Extract rate limit info from 429 errors before recording failure
      const fallbackAdapter = this.resolveFallback(config, primary.id, overrides)
      this.handleRateLimitDetection(err, primary, fallbackAdapter)
      this.recordFailure(primaryTrackingKey, err)

      // On retryable errors, try fallback
      if (this.isRetryableError(err)) {
        if (fallbackAdapter) {
          console.log(
            `[ProviderRouter] ${primaryTrackingKey} failed (${this.errorSummary(err)}) — falling back to ${fallbackAdapter.id}`
          )
          try {
            const fallbackResponse = await this.executeWithTracking(fallbackAdapter, request)
            this.recordSuccess(fallbackAdapter.id)
            return fallbackResponse
          } catch (fallbackErr) {
            this.recordFailure(fallbackAdapter.id, fallbackErr)
            console.log(
              `[ProviderRouter] Fallback ${fallbackAdapter.id} also failed (${this.errorSummary(fallbackErr)}) — re-throwing primary error`
            )
            // Re-throw the original error as it's more relevant
            throw err
          }
        }
      }

      throw err
    }
  }

  /**
   * Build a circuit-breaker tracking key for a provider adapter.
   * For subscription adapters with multi-account, includes the account index.
   */
  private getTrackingKey(adapter: ProviderAdapter): string {
    // Check if the adapter has an accountIndex property (subscription adapters)
    const accountIndex = (adapter as { accountIndex?: number }).accountIndex
    if (accountIndex !== undefined && accountIndex > 0) {
      return `${adapter.id}::${accountIndex}`
    }
    return adapter.id
  }

  async listModels(config: AppConfig): Promise<ModelInfo[]> {
    try {
      const provider = this.resolveProvider(config)
      return await provider.listModels()
    } catch {
      return []
    }
  }

  /**
   * List models from ALL connected/configured providers, grouped by provider.
   * A provider is considered "connected" if:
   * - Subscription providers: have at least one account in TokenStore
   * - OpenRouter: has an API key configured
   * - Custom: has a URL configured
   */
  async listAllConnectedModels(config: AppConfig): Promise<ProviderModelGroup[]> {
    const groups: ProviderModelGroup[] = []
    const tasks: Array<Promise<void>> = []

    // Check subscription providers (parallel)
    const subscriptionIds: AIProviderType[] = [
      'claude-subscription',
      'openai-subscription',
      'gemini-subscription',
      'kimi-subscription',
    ]

    for (const providerId of subscriptionIds) {
      // For kimi, check if there's an API key or accounts
      if (providerId === 'kimi-subscription') {
        const hasAccounts = this.tokenStore ? this.tokenStore.getAccountCount(providerId) > 0 : false
        const hasKey = !!config.customEndpointKey
        if (!hasAccounts && !hasKey) continue
      } else {
        // Other subscription providers: check if any accounts exist
        if (!this.tokenStore || this.tokenStore.getAccountCount(providerId) === 0) continue
      }

      tasks.push(
        (async () => {
          try {
            const tempConfig = { ...config, aiProvider: providerId }
            const provider = this.resolveProvider(tempConfig)
            const models = await provider.listModels()
            if (models.length > 0) {
              groups.push({
                providerId,
                providerName: PROVIDER_NAMES[providerId] ?? providerId,
                models,
              })
            }
          } catch {
            // Provider not functional — skip
          }
        })()
      )
    }

    // Check OpenRouter
    if (config.openRouterKey) {
      tasks.push(
        (async () => {
          try {
            const provider = new OpenRouterAdapter(config.openRouterKey)
            const models = await provider.listModels()
            if (models.length > 0) {
              groups.push({
                providerId: 'openrouter',
                providerName: PROVIDER_NAMES['openrouter'] ?? 'OpenRouter',
                models,
              })
            }
          } catch {
            // OpenRouter not functional — skip
          }
        })()
      )
    }

    // Check Custom Endpoint
    if (config.customEndpointUrl) {
      tasks.push(
        (async () => {
          try {
            const provider = new CustomEndpointAdapter(
              config.customEndpointUrl,
              config.customEndpointKey || ''
            )
            const models = await provider.listModels()
            if (models.length > 0) {
              groups.push({
                providerId: 'custom',
                providerName: PROVIDER_NAMES['custom'] ?? 'Custom Endpoint',
                models,
              })
            }
          } catch {
            // Custom endpoint not functional — skip
          }
        })()
      )
    }

    await Promise.all(tasks)

    // Sort groups: subscription providers first, then OpenRouter, then custom
    const ORDER: Record<string, number> = {
      'claude-subscription': 0,
      'openai-subscription': 1,
      'gemini-subscription': 2,
      'kimi-subscription': 3,
      openrouter: 4,
      custom: 5,
    }
    groups.sort((a, b) => (ORDER[a.providerId] ?? 99) - (ORDER[b.providerId] ?? 99))

    return groups
  }

  async healthCheck(config: AppConfig): Promise<ProviderHealth> {
    try {
      const provider = this.resolveProvider(config)
      return await provider.healthCheck()
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  }

  // ─── Rate Limit State (public API) ─────────────────────────────────────────

  getRateLimitState(): RateLimitInfo[] {
    const now = Date.now()
    const active: RateLimitInfo[] = []

    for (const [providerId, info] of this.rateLimitState) {
      // Only include entries that haven't expired yet
      if (info.resetAt && info.resetAt > now) {
        active.push(info)
      } else if (info.retryAfterMs) {
        const expiresAt = info.detectedAt + info.retryAfterMs
        if (expiresAt > now) {
          active.push(info)
        } else {
          // Expired — clean up
          this.rateLimitState.delete(providerId)
        }
      }
    }

    return active
  }

  // ─── Rate Limit Detection ─────────────────────────────────────────────────

  private handleRateLimitDetection(
    err: unknown,
    provider: ProviderAdapter,
    fallback: ProviderAdapter | null,
  ): void {
    if (!(err instanceof ProviderHttpError)) return
    if (err.status !== 429) return

    const info = this.extractRateLimitHeaders(err.headers, provider, fallback)

    // Store rate limit state
    this.rateLimitState.set(provider.id, info)

    // Use retryAfterMs to set circuit breaker cooldown (instead of fixed 2 min)
    if (info.retryAfterMs && info.retryAfterMs > 0) {
      const state = this.circuitState.get(provider.id)
      if (state) {
        state.openUntil = Date.now() + info.retryAfterMs
        console.log(
          `[ProviderRouter] Adjusted circuit cooldown for ${provider.id} to ${Math.round(info.retryAfterMs / 1000)}s (from Retry-After header)`
        )
      }
    }

    // Broadcast to all renderer windows
    this.broadcastToWindows('provider:rateLimited', info)

    // Schedule auto-clear when cooldown expires
    const cooldownMs = info.retryAfterMs
      ?? (info.resetAt ? info.resetAt - Date.now() : null)
      ?? ProviderRouter.CIRCUIT_COOLDOWN_MS

    if (cooldownMs > 0) {
      // Clear any existing timer for this provider
      const existing = this.rateLimitTimers.get(provider.id)
      if (existing) clearTimeout(existing)

      const timer = setTimeout(() => {
        this.rateLimitState.delete(provider.id)
        this.rateLimitTimers.delete(provider.id)
        this.broadcastToWindows('provider:rateLimitCleared', { provider: provider.id })
        console.log(`[ProviderRouter] Rate limit cleared for ${provider.id}`)
      }, cooldownMs)

      this.rateLimitTimers.set(provider.id, timer)
    }
  }

  private extractRateLimitHeaders(
    headers: Headers,
    provider: ProviderAdapter,
    fallback: ProviderAdapter | null,
  ): RateLimitInfo {
    const now = Date.now()

    // Parse retry-after (seconds or HTTP-date)
    let retryAfterMs: number | null = null
    const retryAfter = headers.get('retry-after')
    if (retryAfter) {
      const seconds = Number(retryAfter)
      if (!isNaN(seconds) && seconds > 0) {
        retryAfterMs = seconds * 1000
      } else {
        // Try parsing as HTTP-date
        const date = Date.parse(retryAfter)
        if (!isNaN(date)) {
          retryAfterMs = Math.max(0, date - now)
        }
      }
    }

    // Parse standard x-ratelimit-* headers
    const remaining = this.parseHeaderNumber(
      headers.get('x-ratelimit-remaining')
      ?? headers.get('anthropic-ratelimit-requests-remaining')
      ?? headers.get('anthropic-ratelimit-tokens-remaining')
    )

    const limit = this.parseHeaderNumber(
      headers.get('x-ratelimit-limit')
      ?? headers.get('anthropic-ratelimit-requests-limit')
      ?? headers.get('anthropic-ratelimit-tokens-limit')
    )

    // Parse reset timestamp
    let resetAt: number | null = null
    const resetHeader =
      headers.get('x-ratelimit-reset')
      ?? headers.get('anthropic-ratelimit-requests-reset')
      ?? headers.get('anthropic-ratelimit-tokens-reset')

    if (resetHeader) {
      const resetSeconds = Number(resetHeader)
      if (!isNaN(resetSeconds) && resetSeconds > 0) {
        // Could be epoch seconds (> 1e9) or relative seconds (small number)
        if (resetSeconds > 1e9) {
          resetAt = resetSeconds * 1000 // epoch seconds → ms
        } else {
          resetAt = now + resetSeconds * 1000 // relative seconds
        }
      } else {
        // Try parsing as ISO 8601 / HTTP-date
        const date = Date.parse(resetHeader)
        if (!isNaN(date)) {
          resetAt = date
        }
      }
    }

    // If we still don't have retryAfterMs but have resetAt, derive it
    if (!retryAfterMs && resetAt) {
      retryAfterMs = Math.max(0, resetAt - now)
    }

    // If we still don't have anything, default to circuit breaker cooldown
    if (!retryAfterMs) {
      retryAfterMs = ProviderRouter.CIRCUIT_COOLDOWN_MS
      resetAt = now + retryAfterMs
    }

    return {
      provider: provider.id,
      providerName: PROVIDER_NAMES[provider.id] ?? provider.name,
      retryAfterMs,
      remaining,
      limit,
      resetAt,
      detectedAt: now,
      fallbackProvider: fallback ? (PROVIDER_NAMES[fallback.id] ?? fallback.name) : null,
    }
  }

  private parseHeaderNumber(value: string | null): number | null {
    if (!value) return null
    const num = Number(value)
    return isNaN(num) ? null : num
  }

  private broadcastToWindows(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, payload)
      }
    }
  }

  // ─── Circuit Breaker ────────────────────────────────────────────────────────

  private isCircuitOpen(providerId: string): boolean {
    const state = this.circuitState.get(providerId)
    if (!state) return false

    if (state.failures < ProviderRouter.CIRCUIT_THRESHOLD) return false

    // Circuit is open — check if cooldown has elapsed (half-open)
    if (Date.now() >= state.openUntil) {
      // Cooldown elapsed — transition to half-open by resetting failures to threshold-1
      // The next failure will immediately re-open the circuit
      state.failures = ProviderRouter.CIRCUIT_THRESHOLD - 1
      state.openUntil = 0
      console.log(`[ProviderRouter] Circuit half-open for ${providerId} — allowing probe request`)
      return false
    }

    return true
  }

  private recordFailure(providerId: string, _err?: unknown): void {
    let state = this.circuitState.get(providerId)
    if (!state) {
      state = { failures: 0, openUntil: 0 }
      this.circuitState.set(providerId, state)
    }

    state.failures++

    if (state.failures >= ProviderRouter.CIRCUIT_THRESHOLD) {
      // If we have rate limit info with retryAfterMs, use that instead of default cooldown
      const rateLimitInfo = this.rateLimitState.get(providerId)
      const cooldownMs = rateLimitInfo?.retryAfterMs ?? ProviderRouter.CIRCUIT_COOLDOWN_MS
      state.openUntil = Date.now() + cooldownMs
      console.log(
        `[ProviderRouter] Circuit OPEN for ${providerId} — ${state.failures} consecutive failures, cooldown ${Math.round(cooldownMs / 1000)}s`
      )
    }
  }

  private recordSuccess(providerId: string): void {
    if (this.circuitState.has(providerId)) {
      this.circuitState.delete(providerId)
    }
    // Clear rate limit state on success (provider is back)
    if (this.rateLimitState.has(providerId)) {
      this.rateLimitState.delete(providerId)
      const timer = this.rateLimitTimers.get(providerId)
      if (timer) {
        clearTimeout(timer)
        this.rateLimitTimers.delete(providerId)
      }
      this.broadcastToWindows('provider:rateLimitCleared', { provider: providerId })
    }
  }

  // ─── Error Classification ──────────────────────────────────────────────────

  private isRetryableError(err: unknown): boolean {
    // Fast path: check ProviderHttpError status
    if (err instanceof ProviderHttpError) {
      if (err.status === 429) return true
      if (err.status >= 500 && err.status < 600) return true
    }

    if (!(err instanceof Error)) return false

    const message = err.message.toLowerCase()

    // HTTP 429 (rate limited)
    if (message.includes('429') || message.includes('rate limit')) return true

    // HTTP 5xx server errors
    if (/\b5\d{2}\b/.test(message)) return true

    // Network / fetch errors
    if (
      message.includes('fetch failed') ||
      message.includes('network') ||
      message.includes('econnrefused') ||
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('socket hang up') ||
      message.includes('dns') ||
      message.includes('timeout')
    ) {
      return true
    }

    return false
  }

  private errorSummary(err: unknown): string {
    if (err instanceof Error) return err.message.slice(0, 120)
    return String(err).slice(0, 120)
  }

  // ─── Fallback Resolution ──────────────────────────────────────────────────

  private resolveFallback(
    config: AppConfig,
    primaryId: string,
    overrides?: { apiKey?: string }
  ): ProviderAdapter | null {
    // Respect user's fallback preference
    if (config.fallbackProvider === 'none') return null

    // Can't fallback to OpenRouter if already using it
    if (primaryId === 'openrouter') return null

    const openRouterKey = overrides?.apiKey || config.openRouterKey
    if (!openRouterKey) return null

    // Return a fresh OpenRouter adapter — does NOT update the provider cache
    return new OpenRouterAdapter(openRouterKey)
  }

  // ─── Execution with Tracking ──────────────────────────────────────────────

  private async executeWithTracking(
    provider: ProviderAdapter,
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const start = Date.now()
    const model = request.model

    try {
      const response = await provider.chatCompletion(request)
      const latencyMs = Date.now() - start

      console.log(
        `[ProviderRouter] ${provider.id} | model=${model} | ${latencyMs}ms | OK` +
          (response.usage
            ? ` | tokens: ${response.usage.prompt_tokens ?? 0}in/${response.usage.completion_tokens ?? 0}out`
            : '')
      )

      return {
        ...response,
        providerId: provider.id,
        providerName: provider.name,
      }
    } catch (err) {
      const latencyMs = Date.now() - start

      console.log(
        `[ProviderRouter] ${provider.id} | model=${model} | ${latencyMs}ms | ERROR: ${this.errorSummary(err)}`
      )

      throw err
    }
  }

  // ─── Cache Key ────────────────────────────────────────────────────────────

  private buildCacheKey(
    providerType: string,
    config: AppConfig,
    overrides?: { apiKey?: string },
    accountIndex: number = 0,
  ): string {
    const parts = [providerType]
    if (providerType === 'openrouter') {
      parts.push(overrides?.apiKey || config.openRouterKey || '')
    } else if (providerType === 'custom') {
      parts.push(config.customEndpointUrl || '', config.customEndpointKey || '')
    } else if (SUBSCRIPTION_PROVIDERS.has(providerType)) {
      parts.push(providerType, String(accountIndex))
    }
    return parts.join('::')
  }
}
