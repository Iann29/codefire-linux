import Database from 'better-sqlite3'
import { GmailDAO } from '../database/dao/GmailDAO'
import { TaskDAO } from '../database/dao/TaskDAO'
import type { GoogleOAuth, OAuthTokens } from './GoogleOAuth'
import type {
  GmailAccount,
  WhitelistRule,
  ProcessedEmail,
  TaskItem,
} from '@shared/models'

/** Minimal representation of a Gmail message header */
interface GmailMessageMetadata {
  id: string
  threadId: string
  from: string // "Name <email@example.com>" or just "email@example.com"
  subject: string
  date: string
  snippet: string
}

/**
 * GmailService manages Gmail accounts, whitelist rules, and email polling.
 *
 * It stores tokens in a Map (keyed by account ID) in memory for the session.
 * The tokens are not persisted to the database because the database schema
 * doesn't have token columns — if we need persistence across restarts, we
 * would add safeStorage encryption later.
 */
export class GmailService {
  private gmailDAO: GmailDAO
  private taskDAO: TaskDAO

  /** In-memory token storage keyed by account ID */
  private tokens = new Map<string, OAuthTokens>()

  constructor(
    private db: Database.Database,
    private oauth: GoogleOAuth
  ) {
    this.gmailDAO = new GmailDAO(db)
    this.taskDAO = new TaskDAO(db)
  }

  // ─── Account Management ──────────────────────────────────────────────────────

  /**
   * Run the full OAuth flow: open browser window, receive callback, exchange
   * code, fetch user email, and store the account. Returns the new account.
   */
  async authenticate(): Promise<GmailAccount> {
    const tokens = await this.oauth.authenticate()
    return this.addAccount(tokens)
  }

  /**
   * Add a new Gmail account after successful OAuth authentication.
   * Fetches the user's email from Google's userinfo endpoint.
   */
  async addAccount(tokens: OAuthTokens): Promise<GmailAccount> {
    const email = await this.oauth.getUserEmail(tokens.accessToken)

    // Check if account already exists
    const existing = this.gmailDAO.getByEmail(email)
    if (existing) {
      // Reactivate and update tokens
      this.gmailDAO.update(existing.id, { isActive: 1 })
      this.tokens.set(existing.id, tokens)
      return this.gmailDAO.getById(existing.id)!
    }

    const account = this.gmailDAO.create({
      email,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: new Date(tokens.expiresAt).toISOString(),
    })

    this.tokens.set(account.id, tokens)
    return account
  }

  /**
   * Remove a Gmail account and its in-memory tokens.
   */
  removeAccount(accountId: string): void {
    this.gmailDAO.delete(accountId)
    this.tokens.delete(accountId)
  }

  /**
   * List all Gmail accounts.
   */
  listAccounts(): GmailAccount[] {
    return this.gmailDAO.list()
  }

  // ─── Whitelist Rules ─────────────────────────────────────────────────────────

  /**
   * Add a whitelist rule. The pattern can be:
   * - An email address: "user@example.com"
   * - A domain: "@example.com"
   * - A subject keyword: "subject:invoice"
   */
  addWhitelistRule(data: {
    pattern: string
    clientId?: string
    priority?: number
    note?: string
  }): WhitelistRule {
    return this.gmailDAO.createRule(data)
  }

  removeWhitelistRule(ruleId: string): void {
    this.gmailDAO.deleteRule(ruleId)
  }

  listWhitelistRules(): WhitelistRule[] {
    return this.gmailDAO.listRules()
  }

  // ─── Email Polling ───────────────────────────────────────────────────────────

  /**
   * Poll for new unread emails that match whitelist rules.
   *
   * Algorithm:
   * 1. Get account, refresh token if expired
   * 2. Fetch unread message IDs from Gmail API
   * 3. Fetch metadata for each message
   * 4. Filter by whitelist rules
   * 5. Skip already-processed messages
   * 6. Store matching emails in processedEmails table
   * 7. Return newly processed emails
   */
  async pollEmails(accountId: string): Promise<ProcessedEmail[]> {
    const account = this.gmailDAO.getById(accountId)
    if (!account) {
      throw new Error(`Gmail account not found: ${accountId}`)
    }

    const accessToken = await this.getValidToken(accountId)
    const rules = this.gmailDAO.listRules()

    if (rules.length === 0) {
      return [] // No whitelist rules, nothing to match
    }

    // Fetch unread message IDs
    const messageIds = await this.fetchUnreadMessageIds(accessToken)
    if (messageIds.length === 0) {
      return []
    }

    const newEmails: ProcessedEmail[] = []

    for (const msgId of messageIds) {
      // Skip already-processed messages
      if (this.gmailDAO.isProcessed(msgId)) {
        continue
      }

      // Fetch message metadata
      const metadata = await this.fetchMessageMetadata(accessToken, msgId)
      if (!metadata) continue

      // Check against whitelist rules
      if (!this.matchesWhitelist(metadata, rules)) {
        continue
      }

      // Parse sender info
      const { email: senderEmail, name: senderName } = this.parseSender(
        metadata.from
      )

      // Store as processed
      const processed = this.gmailDAO.markProcessed({
        messageId: metadata.id,
        threadId: metadata.threadId,
        accountId,
        senderEmail,
        senderName,
        subject: metadata.subject,
        snippet: metadata.snippet,
        receivedAt: metadata.date,
      })

      newEmails.push(processed)
    }

    // Update last sync time
    this.gmailDAO.update(accountId, {
      lastSyncAt: new Date().toISOString(),
    })

    return newEmails
  }

  /**
   * Process new emails and create tasks for each one.
   */
  async processNewEmails(
    accountId: string,
    projectId: string
  ): Promise<TaskItem[]> {
    const emails = await this.pollEmails(accountId)
    const tasks: TaskItem[] = []

    for (const email of emails) {
      const task = this.taskDAO.create({
        projectId,
        title: email.subject || '(No subject)',
        description: `From: ${email.fromAddress}\nSnippet: ${email.snippet ?? ''}`,
        source: 'ai-extracted',
        labels: ['gmail'],
      })

      // Link the task to the processed email
      this.db
        .prepare('UPDATE taskItems SET gmailMessageId = ?, gmailThreadId = ? WHERE id = ?')
        .run(email.gmailMessageId, email.gmailThreadId, task.id)

      // Link the email to the task
      this.db
        .prepare('UPDATE processedEmails SET taskId = ? WHERE id = ?')
        .run(task.id, email.id)

      tasks.push(this.taskDAO.getById(task.id)!)
    }

    return tasks
  }

  // ─── Token Management ────────────────────────────────────────────────────────

  /**
   * Get a valid access token for the account, refreshing if expired.
   */
  private async getValidToken(accountId: string): Promise<string> {
    const tokens = this.tokens.get(accountId)
    if (!tokens) {
      throw new Error(
        `No tokens stored for account ${accountId}. Re-authentication required.`
      )
    }

    // Refresh if token expires within 5 minutes
    if (tokens.expiresAt - Date.now() < 5 * 60 * 1000) {
      if (!tokens.refreshToken) {
        throw new Error(
          `Token expired and no refresh token available for account ${accountId}`
        )
      }

      const refreshed = await this.oauth.refreshToken(tokens.refreshToken)
      this.tokens.set(accountId, refreshed)
      return refreshed.accessToken
    }

    return tokens.accessToken
  }

  /**
   * Store tokens for an account (used when loading from external storage).
   */
  setTokens(accountId: string, tokens: OAuthTokens): void {
    this.tokens.set(accountId, tokens)
  }

  // ─── Gmail API ───────────────────────────────────────────────────────────────

  /**
   * Fetch IDs of unread messages from the Gmail API.
   */
  private async fetchUnreadMessageIds(
    accessToken: string
  ): Promise<string[]> {
    const url = new URL(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages'
    )
    url.searchParams.set('q', 'is:unread')
    url.searchParams.set('maxResults', '50')

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      throw new Error(
        `Gmail API error (${response.status}): ${await response.text()}`
      )
    }

    const data = (await response.json()) as {
      messages?: Array<{ id: string; threadId: string }>
    }

    return data.messages?.map((m) => m.id) ?? []
  }

  /**
   * Fetch metadata (headers) for a single Gmail message.
   */
  private async fetchMessageMetadata(
    accessToken: string,
    messageId: string
  ): Promise<GmailMessageMetadata | null> {
    const url = `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      // Skip individual message errors (e.g., deleted between list and get)
      if (response.status === 404) return null
      throw new Error(
        `Gmail API error (${response.status}): ${await response.text()}`
      )
    }

    const data = (await response.json()) as {
      id: string
      threadId: string
      snippet: string
      payload?: {
        headers?: Array<{ name: string; value: string }>
      }
    }

    const headers = data.payload?.headers ?? []
    const getHeader = (name: string): string =>
      headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ??
      ''

    return {
      id: data.id,
      threadId: data.threadId,
      from: getHeader('From'),
      subject: getHeader('Subject'),
      date: getHeader('Date'),
      snippet: data.snippet ?? '',
    }
  }

  // ─── Whitelist Matching ──────────────────────────────────────────────────────

  /**
   * Check if a message matches any active whitelist rule.
   *
   * Rule pattern formats:
   * - "user@example.com" — exact sender email match
   * - "@example.com" — sender domain match
   * - "subject:keyword" — subject contains keyword (case-insensitive)
   */
  matchesWhitelist(
    message: GmailMessageMetadata,
    rules: WhitelistRule[]
  ): boolean {
    const { email: senderEmail } = this.parseSender(message.from)
    const senderDomain = senderEmail.includes('@')
      ? '@' + senderEmail.split('@')[1].toLowerCase()
      : ''

    for (const rule of rules) {
      if (!rule.isActive) continue

      const pattern = rule.pattern.trim().toLowerCase()

      // Subject match: "subject:keyword"
      if (pattern.startsWith('subject:')) {
        const keyword = pattern.slice('subject:'.length).trim()
        if (
          keyword &&
          message.subject.toLowerCase().includes(keyword)
        ) {
          return true
        }
        continue
      }

      // Domain match: "@example.com"
      if (pattern.startsWith('@')) {
        if (senderDomain === pattern) {
          return true
        }
        continue
      }

      // Exact email match
      if (senderEmail.toLowerCase() === pattern) {
        return true
      }
    }

    return false
  }

  /**
   * Parse a "From" header value into email and display name.
   * Handles formats like:
   * - "John Doe <john@example.com>"
   * - "<john@example.com>"
   * - "john@example.com"
   */
  parseSender(from: string): { email: string; name: string } {
    const angleMatch = from.match(/<([^>]+)>/)
    if (angleMatch) {
      const email = angleMatch[1].trim()
      const name = from.slice(0, from.indexOf('<')).trim().replace(/^"|"$/g, '')
      return { email, name }
    }

    // Plain email address
    return { email: from.trim(), name: '' }
  }
}
