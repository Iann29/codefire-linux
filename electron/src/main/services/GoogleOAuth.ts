import http from 'node:http'
import { URL, URLSearchParams } from 'node:url'
import { BrowserWindow } from 'electron'

export interface OAuthTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number // Unix timestamp in milliseconds
}

/**
 * Handles Google OAuth 2.0 authorization code flow.
 *
 * Opens a BrowserWindow for the user to sign in, runs a local HTTP server
 * to receive the callback, then exchanges the authorization code for tokens.
 */
export class GoogleOAuth {
  private redirectUri = 'http://localhost:8912/oauth/callback'
  private scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
  ]

  constructor(
    private clientId: string,
    private clientSecret: string
  ) {}

  /**
   * Start the OAuth flow: open a browser window for Google login, receive
   * the callback on a local HTTP server, exchange the code for tokens.
   */
  async authenticate(): Promise<OAuthTokens> {
    return new Promise<OAuthTokens>((resolve, reject) => {
      let server: http.Server | null = null
      let authWindow: BrowserWindow | null = null

      const cleanup = () => {
        if (authWindow && !authWindow.isDestroyed()) {
          authWindow.close()
          authWindow = null
        }
        if (server) {
          server.close()
          server = null
        }
      }

      // 1. Start local HTTP server to receive the callback
      server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', `http://localhost:8912`)

          if (url.pathname !== '/oauth/callback') {
            res.writeHead(404)
            res.end('Not found')
            return
          }

          const code = url.searchParams.get('code')
          const error = url.searchParams.get('error')

          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(
              '<html><body><h2>Authorization denied.</h2><p>You can close this window.</p></body></html>'
            )
            cleanup()
            reject(new Error(`OAuth error: ${error}`))
            return
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' })
            res.end(
              '<html><body><h2>Missing authorization code.</h2></body></html>'
            )
            cleanup()
            reject(new Error('No authorization code received'))
            return
          }

          // 4. Exchange code for tokens
          const tokens = await this.exchangeCode(code)

          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body><h2>Authorization successful!</h2><p>You can close this window.</p></body></html>'
          )

          cleanup()
          resolve(tokens)
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' })
          res.end(
            '<html><body><h2>An error occurred.</h2></body></html>'
          )
          cleanup()
          reject(err)
        }
      })

      server.listen(8912, () => {
        // 2. Build the Google OAuth URL
        const params = new URLSearchParams({
          client_id: this.clientId,
          redirect_uri: this.redirectUri,
          response_type: 'code',
          scope: this.scopes.join(' '),
          access_type: 'offline',
          prompt: 'consent',
        })

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

        // 3. Open BrowserWindow for user login
        authWindow = new BrowserWindow({
          width: 600,
          height: 700,
          show: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
          },
        })

        authWindow.loadURL(authUrl)

        authWindow.on('closed', () => {
          authWindow = null
          // If the window is closed before callback, reject
          if (server) {
            cleanup()
            reject(new Error('Authentication window was closed'))
          }
        })
      })

      server.on('error', (err) => {
        cleanup()
        reject(
          new Error(`Failed to start OAuth callback server: ${err.message}`)
        )
      })
    })
  }

  /**
   * Exchange an authorization code for access and refresh tokens.
   */
  private async exchangeCode(code: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
    })

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Token exchange failed (${response.status}): ${text}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    if (!data.access_token) {
      throw new Error('No access token in response')
    }

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? '',
      expiresAt: Date.now() + data.expires_in * 1000,
    }
  }

  /**
   * Refresh an expired access token using a refresh token.
   */
  async refreshToken(refreshToken: string): Promise<OAuthTokens> {
    const body = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: 'refresh_token',
    })

    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`Token refresh failed (${response.status}): ${text}`)
    }

    const data = (await response.json()) as {
      access_token: string
      refresh_token?: string
      expires_in: number
    }

    return {
      accessToken: data.access_token,
      // Google may or may not return a new refresh token
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
    }
  }

  /**
   * Fetch the email address of the authenticated user.
   */
  async getUserEmail(accessToken: string): Promise<string> {
    const response = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    )

    if (!response.ok) {
      throw new Error(
        `Failed to fetch user info (${response.status}): ${await response.text()}`
      )
    }

    const data = (await response.json()) as { email: string }
    return data.email
  }
}
