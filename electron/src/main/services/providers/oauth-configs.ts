/**
 * OAuth configurations per subscription provider.
 *
 * These mirror the OAuth flows used by the official CLIs:
 * - Claude Code CLI (Anthropic PKCE OAuth)
 * - Codex CLI (OpenAI Auth0 PKCE OAuth)
 * - Gemini CLI (Google OAuth 2.0)
 *
 * Client IDs and URLs are extracted from the respective CLI source/binaries.
 * If a provider changes their OAuth flow, update only this file.
 */

export interface OAuthProviderConfig {
  id: string
  name: string
  authUrl: string
  tokenUrl: string
  clientId: string
  scopes: string[]
  redirectUri: string
  usePKCE: boolean
  apiBaseUrl: string
  /** Extra params to include in the authorization request */
  extraAuthParams?: Record<string, string>
  /** Extra headers for the token exchange request */
  extraTokenHeaders?: Record<string, string>
  /** URL to fetch user profile after auth (for account info) */
  profileUrl?: string
  /**
   * If true, the provider shows the auth code on a web page for the user
   * to copy and paste back into the app (e.g. Claude).
   * If false, uses localhost HTTP callback to capture the code automatically.
   */
  codeCopyFlow?: boolean
  /**
   * If true, the provider uses a direct token input flow instead of OAuth.
   * The user generates a token externally (e.g. `claude setup-token`) and
   * pastes it into the app. No browser OAuth flow is used.
   */
  tokenInputFlow?: boolean
  /** Hint text shown in the token input UI */
  tokenInputHint?: string
  /** Extra headers to include in API requests (e.g. anthropic-beta for OAuth tokens) */
  extraApiHeaders?: Record<string, string>
  /** ChatGPT Codex responses endpoint (for subscription-based calls via ChatGPT backend) */
  chatgptCodexUrl?: string
}

export interface ApiKeyProviderConfig {
  id: string
  name: string
  apiBaseUrl: string
  userAgent?: string
}

export type SubscriptionProviderConfig = OAuthProviderConfig | ApiKeyProviderConfig

export function isOAuthConfig(c: SubscriptionProviderConfig): c is OAuthProviderConfig {
  return 'authUrl' in c
}

// ─── Claude (Anthropic) ─────────────────────────────────────────────────────
// Flow: PKCE OAuth 2.0 — same as Claude Code CLI
// Reference: claude-code-proxy, CLIProxyAPI --claude-login

export const CLAUDE_OAUTH: OAuthProviderConfig = {
  id: 'claude-subscription',
  name: 'Claude (Subscription)',
  // OAuth URLs kept for reference but not used — Claude uses direct token flow
  authUrl: 'https://platform.claude.com/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  scopes: ['org:create_api_key', 'user:profile', 'user:inference'],
  redirectUri: 'https://platform.claude.com/oauth/code/callback',
  usePKCE: true,
  apiBaseUrl: 'https://api.anthropic.com',
  profileUrl: 'https://api.anthropic.com/v1/me',
  // Direct token flow: user runs `claude setup-token` and pastes the token
  tokenInputFlow: true,
  tokenInputHint: 'Run "claude setup-token" in your terminal, then paste the sk-ant-oat01-... token here.',
  extraApiHeaders: {
    'anthropic-beta': 'oauth-2025-04-20',
    'user-agent': 'claude-cli/2.1.71',
  },
}

// ─── OpenAI (ChatGPT Plus/Pro) ──────────────────────────────────────────────
// Flow: Auth0 PKCE OAuth 2.0 — same as OpenCode / Codex CLI
// Reference: opencode source, intent-prompt-mvp working implementation

export const OPENAI_OAUTH: OAuthProviderConfig = {
  id: 'openai-subscription',
  name: 'ChatGPT (Subscription)',
  authUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  scopes: ['openid', 'profile', 'email', 'offline_access'],
  // Must match exactly what's registered for this client_id at OpenAI
  redirectUri: 'http://localhost:1455/auth/callback',
  usePKCE: true,
  apiBaseUrl: 'https://api.openai.com',
  /** ChatGPT Codex responses endpoint (used for subscription-based calls) */
  chatgptCodexUrl: 'https://chatgpt.com/backend-api/codex/responses',
  extraAuthParams: {
    // No 'audience' — the working intent-prompt-mvp implementation doesn't send it
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'opencode',
  },
  profileUrl: 'https://api.openai.com/v1/me',
}

// ─── Google (Gemini Advanced) ───────────────────────────────────────────────
// Flow: Standard Google OAuth 2.0 — same as Gemini CLI
// Reference: gemini-cli source

export const GEMINI_OAUTH: OAuthProviderConfig = {
  id: 'gemini-subscription',
  name: 'Gemini (Subscription)',
  authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenUrl: 'https://oauth2.googleapis.com/token',
  clientId: '539778044953-crltqtao8vjfbjrmsg37vs7bf1tspiov.apps.googleusercontent.com',
  scopes: [
    'https://www.googleapis.com/auth/generative-language',
    'https://www.googleapis.com/auth/userinfo.email',
  ],
  redirectUri: 'http://localhost:19485/oauth/callback',
  usePKCE: true,
  apiBaseUrl: 'https://generativelanguage.googleapis.com',
  extraAuthParams: {
    access_type: 'offline',
    prompt: 'consent',
  },
  profileUrl: 'https://www.googleapis.com/oauth2/v2/userinfo',
}

// ─── Kimi (Moonshot) ────────────────────────────────────────────────────────
// Kimi uses API key auth compatible with Anthropic Messages API format.
// No OAuth required — user provides API key directly.

export const KIMI_CONFIG: ApiKeyProviderConfig = {
  id: 'kimi-subscription',
  name: 'Kimi',
  apiBaseUrl: 'https://api.kimi.com/coding/v1',
  userAgent: 'claude-code/1.0',
}

// ─── Registry ───────────────────────────────────────────────────────────────

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  'claude-subscription': CLAUDE_OAUTH,
  'openai-subscription': OPENAI_OAUTH,
  'gemini-subscription': GEMINI_OAUTH,
}

export const ALL_SUBSCRIPTION_PROVIDERS: Record<string, SubscriptionProviderConfig> = {
  'claude-subscription': CLAUDE_OAUTH,
  'openai-subscription': OPENAI_OAUTH,
  'gemini-subscription': GEMINI_OAUTH,
  'kimi-subscription': KIMI_CONFIG,
}
