import { BrowserWindow } from 'electron'
import http from 'http'
import crypto from 'crypto'
import { TokenStore } from './TokenStore'
import { OAUTH_PROVIDERS, type OAuthProviderConfig } from './oauth-configs'

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
  private activeFlow: { window: BrowserWindow; server: http.Server } | null = null

  constructor(tokenStore: TokenStore) {
    this.tokenStore = tokenStore
  }

  /**
   * Start an OAuth flow for the given provider.
   * Opens a BrowserWindow for the user to authenticate, then
   * spins up a local HTTP server to catch the redirect callback.
   */
  async startOAuthFlow(providerId: string): Promise<{ success: boolean; error?: string }> {
    const config = OAUTH_PROVIDERS[providerId]
    if (!config) {
      return { success: false, error: `Unknown OAuth provider: ${providerId}` }
    }

    // Cancel any active flow first
    this.cancelActiveFlow()

    try {
      const authCode = await this.openAuthWindow(config)
      const token = await this.exchangeCodeForTokens(config, authCode.code, authCode.codeVerifier)

      // Fetch user profile if available
      let email: string | null = null
      let name: string | null = null
      if (config.profileUrl) {
        const profile = await this.fetchProfile(config, token.accessToken)
        email = profile.email
        name = profile.name
      }

      this.tokenStore.save({
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
        scope: token.scope,
        accountEmail: email,
        accountName: name,
        providerId,
        createdAt: Date.now(),
      })

      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    } finally {
      this.cancelActiveFlow()
    }
  }

  /**
   * Refresh the access token for a provider.
   */
  async refreshToken(providerId: string): Promise<boolean> {
    const config = OAUTH_PROVIDERS[providerId]
    if (!config) return false

    const stored = this.tokenStore.get(providerId)
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
        console.error(`[OAuthEngine] Token refresh failed for ${providerId}: ${res.status} ${text}`)
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

      // Some providers rotate refresh tokens
      if (json.refresh_token) {
        this.tokenStore.save({
          ...stored,
          accessToken: json.access_token,
          refreshToken: json.refresh_token,
          expiresAt: newExpiresAt,
        })
      } else {
        this.tokenStore.updateAccessToken(providerId, json.access_token, newExpiresAt)
      }

      return true
    } catch (err) {
      console.error(`[OAuthEngine] Token refresh error for ${providerId}:`, err)
      return false
    }
  }

  /**
   * Get a valid access token, refreshing if needed.
   */
  async getValidToken(providerId: string): Promise<string | null> {
    const stored = this.tokenStore.get(providerId)
    if (!stored) return null

    if (this.tokenStore.needsRefresh(providerId)) {
      const refreshed = await this.refreshToken(providerId)
      if (!refreshed) return null
      // Re-read after refresh
      const updated = this.tokenStore.get(providerId)
      return updated?.accessToken ?? null
    }

    return stored.accessToken
  }

  /**
   * Revoke tokens for a provider and remove from storage.
   */
  async revokeTokens(providerId: string): Promise<void> {
    this.tokenStore.remove(providerId)
  }

  /**
   * List connected accounts with their status.
   */
  listAccounts() {
    return this.tokenStore.listAccounts()
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private openAuthWindow(
    config: OAuthProviderConfig
  ): Promise<{ code: string; codeVerifier: string }> {
    return new Promise((resolve, reject) => {
      const state = generateState()
      const codeVerifier = config.usePKCE ? generateCodeVerifier() : ''
      const codeChallenge = config.usePKCE ? generateCodeChallenge(codeVerifier) : ''

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

      // Start local callback server
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
          reject(new Error(`OAuth error: ${error}`))
          return
        }

        if (!code || returnedState !== state) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(this.callbackHtml(false, 'Invalid callback parameters'))
          reject(new Error('Invalid OAuth callback: missing code or state mismatch'))
          return
        }

        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(this.callbackHtml(true))
        resolve({ code, codeVerifier })
      })

      server.listen(CALLBACK_PORT, '127.0.0.1', () => {
        // Open BrowserWindow for OAuth
        const win = new BrowserWindow({
          width: 520,
          height: 720,
          show: true,
          autoHideMenuBar: true,
          title: `Sign in — ${config.name}`,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        })

        win.loadURL(authUrl)

        this.activeFlow = { window: win, server }

        // Timeout
        const timer = setTimeout(() => {
          reject(new Error('OAuth flow timed out (5 minutes)'))
          this.cancelActiveFlow()
        }, OAUTH_TIMEOUT_MS)

        // Cleanup on window close
        win.on('closed', () => {
          clearTimeout(timer)
          server.close()
          this.activeFlow = null
        })
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
  ): Promise<{ email: string | null; name: string | null }> {
    if (!config.profileUrl) return { email: null, name: null }

    try {
      const res = await fetch(config.profileUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'anthropic-version': '2024-10-22',
        },
      })

      if (!res.ok) return { email: null, name: null }

      const json = (await res.json()) as Record<string, unknown>

      // Different providers return profile data differently
      const email = (json.email as string) ?? null
      const name = (json.name as string) ?? (json.display_name as string) ?? null

      return { email, name }
    } catch {
      return { email: null, name: null }
    }
  }

  private cancelActiveFlow(): void {
    if (this.activeFlow) {
      try { this.activeFlow.window.close() } catch { /* already closed */ }
      try { this.activeFlow.server.close() } catch { /* already closed */ }
      this.activeFlow = null
    }
  }

  private callbackHtml(success: boolean, errorMsg?: string): string {
    const title = success ? 'Authentication Successful' : 'Authentication Failed'
    const message = success
      ? 'You can close this window and return to CodeFire.'
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
${success ? '<script>setTimeout(() => window.close(), 2000)</script>' : ''}
</body></html>`
  }
}
