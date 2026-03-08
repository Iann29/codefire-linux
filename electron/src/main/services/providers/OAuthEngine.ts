import { shell } from 'electron'
import http from 'http'
import crypto from 'crypto'
import { TokenStore } from './TokenStore'
import { OAUTH_PROVIDERS, ALL_SUBSCRIPTION_PROVIDERS, type OAuthProviderConfig, isOAuthConfig } from './oauth-configs'

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const CALLBACK_PORT = 19485

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function generateCodeVerifier(): string {
  return base64url(crypto.randomBytes(32))
}

function generateCodeChallenge(verifier: string): string {
  const hash = crypto.createHash('sha256').update(verifier).digest()
  return base64url(hash)
}

function generateState(): string {
  return base64url(crypto.randomBytes(16))
}

export class OAuthEngine {
  private tokenStore: TokenStore
  private activeFlow: { server?: http.Server; timer: NodeJS.Timeout } | null = null

  // For code-copy flow: stores pending PKCE verifier waiting for user to paste code
  private pendingCodeFlow: {
    config: OAuthProviderConfig
    codeVerifier: string
    resolve: (result: { success: boolean; error?: string; accountIndex?: number }) => void
  } | null = null

  constructor(tokenStore: TokenStore) {
    this.tokenStore = tokenStore
  }

  /**
   * Start an OAuth flow for the given provider.
   * - Code-copy flow (Claude): opens browser, returns immediately with `{ success: false, awaitingCode: true }`.
   *   The user must then call `submitOAuthCode(providerId, code)` with the code they copied.
   * - Localhost callback flow (OpenAI, Gemini): opens browser, waits for localhost redirect.
   */
  async startOAuthFlow(providerId: string): Promise<{ success: boolean; error?: string; accountIndex?: number; awaitingCode?: boolean }> {
    const config = OAUTH_PROVIDERS[providerId]
    if (!config) {
      return { success: false, error: `Unknown OAuth provider: ${providerId}` }
    }

    // Cancel any active flow first
    this.cancelActiveFlow()
    this.pendingCodeFlow = null

    const codeVerifier = config.usePKCE ? generateCodeVerifier() : ''
    const codeChallenge = config.usePKCE ? generateCodeChallenge(codeVerifier) : ''
    const state = generateState()

    // Build authorization URL
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: config.scopes.join(' '),
      state,
      ...(config.usePKCE
        ? { code_challenge: codeChallenge, code_challenge_method: 'S256' }
        : {}),
      ...config.extraAuthParams,
    })

    const authUrl = `${config.authUrl}?${params.toString()}`

    if (config.codeCopyFlow) {
      // Code-copy flow: open browser, user will paste code back via submitOAuthCode()
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          this.pendingCodeFlow = null
          resolve({ success: false, error: 'OAuth flow timed out (5 minutes)' })
        }, OAUTH_TIMEOUT_MS)

        this.activeFlow = { timer }
        this.pendingCodeFlow = { config, codeVerifier, resolve: resolve as any }

        shell.openExternal(authUrl)

        // Signal to the UI that it should show a code input
        resolve({ success: false, awaitingCode: true })
      })
    }

    // Localhost callback flow
    try {
      const authCode = await this.openLocalhostCallback(config, authUrl, state, codeVerifier)
      return this.completeOAuthFlow(config, authCode.code, authCode.codeVerifier)
    } catch (err) {
      return { success: false, error: (err as Error).message }
    } finally {
      this.cancelActiveFlow()
    }
  }

  /**
   * Submit the OAuth code the user copied from the provider's page (code-copy flow).
   */
  async submitOAuthCode(providerId: string, code: string): Promise<{ success: boolean; error?: string; accountIndex?: number }> {
    const pending = this.pendingCodeFlow
    if (!pending || pending.config.id !== providerId) {
      return { success: false, error: 'No pending OAuth flow for this provider' }
    }

    this.cancelActiveFlow()
    const result = await this.completeOAuthFlow(pending.config, code, pending.codeVerifier)
    this.pendingCodeFlow = null
    return result
  }

  /**
   * Save a direct token (e.g. from `claude setup-token`) without going through OAuth.
   * Used for providers that use tokenInputFlow.
   */
  async saveDirectToken(
    providerId: string,
    token: string
  ): Promise<{ success: boolean; error?: string; accountIndex?: number }> {
    // Strip whitespace/newlines that may come from copy-paste
    token = token.replace(/\s+/g, '')

    const config = ALL_SUBSCRIPTION_PROVIDERS[providerId]
    if (!config || !isOAuthConfig(config)) {
      return { success: false, error: `Unknown provider: ${providerId}` }
    }

    // Fetch profile if available to get email/name
    let email: string | null = null
    let name: string | null = null
    let tier: string | null = null
    if (config.profileUrl) {
      const profile = await this.fetchProfileWithToken(config, token)
      email = profile.email
      name = profile.name
      tier = profile.tier
    }

    const accountIndex = this.tokenStore.addAccount({
      accessToken: token,
      refreshToken: null,
      expiresAt: 0, // no expiry — setup tokens last ~1 year
      scope: config.scopes.join(' '),
      accountEmail: email,
      accountName: name,
      subscriptionTier: tier,
      providerId: config.id,
      createdAt: Date.now(),
    })

    return { success: true, accountIndex }
  }

  /**
   * Fetch profile using a direct token, including any extra API headers the provider needs.
   */
  private async fetchProfileWithToken(
    config: OAuthProviderConfig,
    token: string
  ): Promise<{ email: string | null; name: string | null; tier: string | null }> {
    if (!config.profileUrl) return { email: null, name: null, tier: null }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
        ...config.extraApiHeaders,
      }

      const res = await fetch(config.profileUrl, { headers })
      if (!res.ok) return { email: null, name: null, tier: null }

      const json = (await res.json()) as Record<string, unknown>
      const email = (json.email as string) ?? null
      const name = (json.name as string) ?? (json.display_name as string) ?? null
      const tier = this.detectTier(config.id, json)

      return { email, name, tier }
    } catch {
      return { email: null, name: null, tier: null }
    }
  }

  /**
   * Refresh the access token for a provider account.
   */
  async refreshToken(providerId: string, accountIndex: number = 0): Promise<boolean> {
    const config = OAUTH_PROVIDERS[providerId]
    if (!config) return false

    const stored = this.tokenStore.getAccount(providerId, accountIndex)
    if (!stored?.refreshToken) return false

    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: stored.refreshToken,
        client_id: config.clientId,
      })

      const headers: Record<string, string> = {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...config.extraTokenHeaders,
      }

      const res = await fetch(config.tokenUrl, {
        method: 'POST',
        headers,
        body: body.toString(),
      })

      if (!res.ok) {
        const text = await res.text()
        console.error(`[OAuthEngine] Token refresh failed for ${providerId}[${accountIndex}]: ${res.status} ${text}`)
        return false
      }

      const json = (await res.json()) as {
        access_token: string
        refresh_token?: string
        expires_in?: number
      }

      const newExpiresAt = json.expires_in
        ? Date.now() + json.expires_in * 1000
        : 0

      // Some providers rotate refresh tokens — re-save at the same index (email match ensures same slot)
      if (json.refresh_token) {
        this.tokenStore.addAccount({
          ...stored,
          accessToken: json.access_token,
          refreshToken: json.refresh_token,
          expiresAt: newExpiresAt,
        })
      } else {
        this.tokenStore.updateAccessToken(providerId, json.access_token, newExpiresAt, accountIndex)
      }

      return true
    } catch (err) {
      console.error(`[OAuthEngine] Token refresh error for ${providerId}[${accountIndex}]:`, err)
      return false
    }
  }

  /**
   * Get a valid access token, refreshing if needed.
   */
  async getValidToken(providerId: string, accountIndex: number = 0): Promise<string | null> {
    const stored = this.tokenStore.getAccount(providerId, accountIndex)
    if (!stored) return null

    if (this.tokenStore.needsRefresh(providerId, accountIndex)) {
      const refreshed = await this.refreshToken(providerId, accountIndex)
      if (!refreshed) return null
      // Re-read after refresh
      const updated = this.tokenStore.getAccount(providerId, accountIndex)
      return updated?.accessToken ?? null
    }

    return stored.accessToken
  }

  /**
   * Revoke tokens for a provider account and remove from storage.
   */
  async revokeTokens(providerId: string, accountIndex: number = 0): Promise<void> {
    this.tokenStore.removeAccount(providerId, accountIndex)
  }

  /**
   * List connected accounts with their status.
   */
  listAccounts() {
    return this.tokenStore.listAccounts()
  }

  // ── Private ────────────────────────────────────────────────────────────────

  /**
   * Complete the OAuth flow: exchange code for tokens, fetch profile, save account.
   */
  private async completeOAuthFlow(
    config: OAuthProviderConfig,
    code: string,
    codeVerifier: string
  ): Promise<{ success: boolean; error?: string; accountIndex?: number }> {
    try {
      const token = await this.exchangeCodeForTokens(config, code, codeVerifier)

      // Fetch user profile if available
      let email: string | null = null
      let name: string | null = null
      let tier: string | null = null
      if (config.profileUrl) {
        const profile = await this.fetchProfile(config, token.accessToken)
        email = profile.email
        name = profile.name
        tier = profile.tier
      }

      const accountIndex = this.tokenStore.addAccount({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scope: token.scope,
        accountEmail: email,
        accountName: name,
        subscriptionTier: tier,
        providerId: config.id,
        createdAt: Date.now(),
      })

      return { success: true, accountIndex }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  /**
   * Localhost callback flow: start HTTP server, open browser, wait for redirect.
   */
  private openLocalhostCallback(
    config: OAuthProviderConfig,
    authUrl: string,
    state: string,
    codeVerifier: string
  ): Promise<{ code: string; codeVerifier: string }> {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        if (!req.url?.startsWith('/oauth/callback')) {
          res.writeHead(404)
          res.end()
          return
        }

        const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`)
        const code = url.searchParams.get('code')
        const returnedState = url.searchParams.get('state')
        const error = url.searchParams.get('error')

        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(this.callbackHtml(false, `Authentication error: ${error}`))
          this.cancelActiveFlow()
          reject(new Error(`OAuth error: ${error}`))
          return
        }

        if (!code || returnedState !== state) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(this.callbackHtml(false, 'Invalid callback parameters'))
          this.cancelActiveFlow()
          reject(new Error('Invalid OAuth callback: missing code or state mismatch'))
          return
        }

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(this.callbackHtml(true))
        this.cancelActiveFlow()
        resolve({ code, codeVerifier })
      })

      server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        shell.openExternal(authUrl)

        const timer = setTimeout(() => {
          reject(new Error('OAuth flow timed out (5 minutes)'))
          this.cancelActiveFlow()
        }, OAUTH_TIMEOUT_MS)

        this.activeFlow = { server, timer }
      })

      server.on('error', (err) => {
        reject(new Error(`Failed to start OAuth callback server: ${err.message}`))
      })
    })
  }

  private async exchangeCodeForTokens(
    config: OAuthProviderConfig,
    code: string,
    codeVerifier: string
  ): Promise<{
    accessToken: string
    refreshToken: string | null
    expiresAt: number
    scope: string
  }> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      ...(config.usePKCE ? { code_verifier: codeVerifier } : {}),
    })

    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...config.extraTokenHeaders,
    }

    const res = await fetch(config.tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    })

    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Token exchange failed: ${res.status} ${text}`)
    }

    const json = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
      scope?: string
      token_type?: string
    }

    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? null,
      expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : 0,
      scope: json.scope ?? config.scopes.join(' '),
    }
  }

  private async fetchProfile(
    config: OAuthProviderConfig,
    accessToken: string
  ): Promise<{ email: string | null; name: string | null; tier: string | null }> {
    if (!config.profileUrl) return { email: null, name: null, tier: null }

    try {
      const res = await fetch(config.profileUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-version': '2023-06-01',
        },
      })

      if (!res.ok) return { email: null, name: null, tier: null }

      const json = (await res.json()) as Record<string, unknown>

      // Different providers return profile data differently
      const email = (json.email as string) ?? null
      const name = (json.name as string) ?? (json.display_name as string) ?? null

      // Detect subscription tier from profile response
      const tier = this.detectTier(config.id, json)

      return { email, name, tier }
    } catch {
      return { email: null, name: null, tier: null }
    }
  }

  /**
   * Detect subscription tier from profile API response.
   * Each provider returns plan info differently.
   */
  private detectTier(providerId: string, profile: Record<string, unknown>): string | null {
    // Claude: /v1/me may return plan or subscription info
    if (providerId === 'claude-subscription') {
      const plan = profile.plan as Record<string, unknown> | undefined
      if (plan?.name) return String(plan.name) // "Pro", "Max", etc.
      if (plan?.tier) return String(plan.tier)
      // Fallback: check scopes for tier hints
      const chatType = profile.chat_type as string | undefined
      if (chatType) return chatType
    }

    // OpenAI: /v1/me may return subscription plan
    if (providerId === 'openai-subscription') {
      const plan = profile.plan as Record<string, unknown> | undefined
      if (plan?.title) return String(plan.title) // "Plus", "Pro", "Team"
      // Check orgs or groups for plan info
      const groups = profile.groups as string[] | undefined
      if (groups?.length) {
        for (const g of groups) {
          if (/plus|pro|team|enterprise/i.test(g)) return g
        }
      }
    }

    // Gemini: Google userinfo doesn't expose subscription tier directly
    // The fact that OAuth succeeded with generative-language scope implies Advanced
    if (providerId === 'gemini-subscription') {
      return 'Advanced'
    }

    return null
  }

  private cancelActiveFlow(): void {
    if (this.activeFlow) {
      clearTimeout(this.activeFlow.timer)
      if (this.activeFlow.server) {
        try { this.activeFlow.server.close() } catch { /* already closed */ }
      }
      this.activeFlow = null
    }
  }

  private callbackHtml(success: boolean, errorMsg?: string): string {
    const title = success ? 'Authentication Successful' : 'Authentication Failed'
    const message = success
      ? 'You can close this tab and return to Pinyino.'
      : `Error: ${errorMsg ?? 'Unknown error'}. Please try again.`
    const color = success ? '#22c55e' : '#ef4444'

    return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${title}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;
         display: flex; align-items: center; justify-content: center;
         min-height: 100vh; margin: 0; background: #0a0a0a; color: #e5e5e5; }
  .card { text-align: center; padding: 2rem; }
  .icon { font-size: 3rem; margin-bottom: 1rem; }
  h1 { font-size: 1.2rem; color: ${color}; margin-bottom: 0.5rem; }
  p { color: #a3a3a3; font-size: 0.9rem; }
</style></head>
<body><div class="card">
  <div class="icon">${success ? '&#10003;' : '&#10007;'}</div>
  <h1>${title}</h1>
  <p>${message}</p>
</div>
</body></html>`
  }
}
