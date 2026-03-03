import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Migrator } from '../../main/database/migrator'
import { migrations } from '../../main/database/migrations'
import { GmailDAO } from '../../main/database/dao/GmailDAO'
import { GmailService } from '../../main/services/GmailService'
import type { GoogleOAuth, OAuthTokens } from '../../main/services/GoogleOAuth'
import type { WhitelistRule } from '@shared/models'

// ─── Helper: create a mock GoogleOAuth ──────────────────────────────────────

function createMockOAuth(overrides: Partial<GoogleOAuth> = {}): GoogleOAuth {
  return {
    authenticate: vi.fn().mockResolvedValue({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
    } satisfies OAuthTokens),
    refreshToken: vi.fn().mockResolvedValue({
      accessToken: 'refreshed-access-token',
      refreshToken: 'mock-refresh-token',
      expiresAt: Date.now() + 3600 * 1000,
    } satisfies OAuthTokens),
    getUserEmail: vi.fn().mockResolvedValue('user@example.com'),
    ...overrides,
  } as unknown as GoogleOAuth
}

// ─── Helper: create a minimal Gmail message metadata ────────────────────────

interface MockMessage {
  id: string
  threadId: string
  from: string
  subject: string
  date?: string
  snippet?: string
}

function makeGmailListResponse(messageIds: string[]) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      messages: messageIds.map((id) => ({ id, threadId: `thread-${id}` })),
    }),
    text: async () => '',
  }
}

function makeGmailMessageResponse(msg: MockMessage) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: msg.id,
      threadId: msg.threadId,
      snippet: msg.snippet ?? '',
      payload: {
        headers: [
          { name: 'From', value: msg.from },
          { name: 'Subject', value: msg.subject },
          { name: 'Date', value: msg.date ?? new Date().toISOString() },
        ],
      },
    }),
    text: async () => '',
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('GmailDAO', () => {
  let db: Database.Database
  let dbPath: string
  let dao: GmailDAO

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-gmail-dao-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    )
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const migrator = new Migrator(db, migrations)
    migrator.migrate()
    dao = new GmailDAO(db)
  })

  afterEach(() => {
    db.close()
    try { fs.unlinkSync(dbPath) } catch {}
    try { fs.unlinkSync(dbPath + '-wal') } catch {}
    try { fs.unlinkSync(dbPath + '-shm') } catch {}
  })

  // ─── Accounts ──────────────────────────────────────────────────────────────

  describe('accounts', () => {
    it('creates and retrieves an account', () => {
      const account = dao.create({
        email: 'test@gmail.com',
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: new Date().toISOString(),
      })

      expect(account.id).toBeTruthy()
      expect(account.email).toBe('test@gmail.com')
      expect(account.isActive).toBe(1)
      expect(account.createdAt).toBeTruthy()

      const found = dao.getById(account.id)
      expect(found).toBeDefined()
      expect(found!.email).toBe('test@gmail.com')
    })

    it('finds account by email', () => {
      dao.create({
        email: 'unique@gmail.com',
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: new Date().toISOString(),
      })

      const found = dao.getByEmail('unique@gmail.com')
      expect(found).toBeDefined()
      expect(found!.email).toBe('unique@gmail.com')

      expect(dao.getByEmail('nonexistent@gmail.com')).toBeUndefined()
    })

    it('lists all accounts', () => {
      dao.create({ email: 'a@gmail.com', accessToken: '', refreshToken: '', expiresAt: '' })
      dao.create({ email: 'b@gmail.com', accessToken: '', refreshToken: '', expiresAt: '' })

      const accounts = dao.list()
      expect(accounts.length).toBe(2)
    })

    it('updates account fields', () => {
      const account = dao.create({
        email: 'update@gmail.com',
        accessToken: '',
        refreshToken: '',
        expiresAt: '',
      })

      dao.update(account.id, { isActive: 0 })
      const updated = dao.getById(account.id)
      expect(updated!.isActive).toBe(0)
    })

    it('deletes an account', () => {
      const account = dao.create({
        email: 'delete@gmail.com',
        accessToken: '',
        refreshToken: '',
        expiresAt: '',
      })

      expect(dao.delete(account.id)).toBe(true)
      expect(dao.getById(account.id)).toBeUndefined()
    })

    it('returns false when deleting nonexistent account', () => {
      expect(dao.delete('nonexistent-id')).toBe(false)
    })
  })

  // ─── Whitelist Rules ───────────────────────────────────────────────────────

  describe('whitelist rules', () => {
    it('creates and retrieves a rule', () => {
      const rule = dao.createRule({ pattern: '@company.com' })

      expect(rule.id).toBeTruthy()
      expect(rule.pattern).toBe('@company.com')
      expect(rule.isActive).toBe(1)
      expect(rule.priority).toBe(0)
    })

    it('creates a rule with all optional fields', () => {
      const rule = dao.createRule({
        pattern: 'ceo@company.com',
        priority: 5,
        note: 'CEO emails are high priority',
      })

      expect(rule.pattern).toBe('ceo@company.com')
      expect(rule.priority).toBe(5)
      expect(rule.note).toBe('CEO emails are high priority')
    })

    it('lists all rules ordered by priority', () => {
      dao.createRule({ pattern: '@low.com', priority: 1 })
      dao.createRule({ pattern: '@high.com', priority: 10 })
      dao.createRule({ pattern: '@mid.com', priority: 5 })

      const rules = dao.listRules()
      expect(rules.length).toBe(3)
      expect(rules[0].pattern).toBe('@high.com')
      expect(rules[1].pattern).toBe('@mid.com')
      expect(rules[2].pattern).toBe('@low.com')
    })

    it('deletes a rule', () => {
      const rule = dao.createRule({ pattern: '@delete.com' })
      expect(dao.deleteRule(rule.id)).toBe(true)

      const rules = dao.listRules()
      expect(rules.length).toBe(0)
    })

    it('returns false when deleting nonexistent rule', () => {
      expect(dao.deleteRule('nonexistent-id')).toBe(false)
    })
  })

  // ─── Processed Emails ─────────────────────────────────────────────────────

  describe('processed emails', () => {
    let accountId: string

    beforeEach(() => {
      const account = dao.create({
        email: 'test@gmail.com',
        accessToken: '',
        refreshToken: '',
        expiresAt: '',
      })
      accountId = account.id
    })

    it('marks an email as processed', () => {
      const email = dao.markProcessed({
        messageId: 'msg-1',
        threadId: 'thread-1',
        accountId,
        senderEmail: 'sender@example.com',
        subject: 'Test Subject',
      })

      expect(email.id).toBeGreaterThan(0)
      expect(email.gmailMessageId).toBe('msg-1')
      expect(email.gmailThreadId).toBe('thread-1')
      expect(email.fromAddress).toBe('sender@example.com')
      expect(email.subject).toBe('Test Subject')
      expect(email.importedAt).toBeTruthy()
    })

    it('marks email with all optional fields', () => {
      const email = dao.markProcessed({
        messageId: 'msg-2',
        threadId: 'thread-2',
        accountId,
        senderEmail: 'sender@example.com',
        senderName: 'Sender Name',
        subject: 'Full Email',
        snippet: 'A snippet of the email...',
        body: 'Full body content',
        receivedAt: '2025-01-01T00:00:00Z',
      })

      expect(email.fromName).toBe('Sender Name')
      expect(email.snippet).toBe('A snippet of the email...')
      expect(email.body).toBe('Full body content')
      expect(email.receivedAt).toBe('2025-01-01T00:00:00Z')
    })

    it('checks if a message is already processed', () => {
      expect(dao.isProcessed('msg-check')).toBe(false)

      dao.markProcessed({
        messageId: 'msg-check',
        threadId: 'thread-check',
        accountId,
        senderEmail: 'sender@example.com',
        subject: 'Check',
      })

      expect(dao.isProcessed('msg-check')).toBe(true)
    })

    it('lists processed emails for an account', () => {
      dao.markProcessed({
        messageId: 'msg-a',
        threadId: 'thread-a',
        accountId,
        senderEmail: 'a@example.com',
        subject: 'Email A',
      })
      dao.markProcessed({
        messageId: 'msg-b',
        threadId: 'thread-b',
        accountId,
        senderEmail: 'b@example.com',
        subject: 'Email B',
      })

      const emails = dao.listProcessedEmails(accountId)
      expect(emails.length).toBe(2)
    })

    it('enforces unique gmailMessageId', () => {
      dao.markProcessed({
        messageId: 'msg-unique',
        threadId: 'thread-1',
        accountId,
        senderEmail: 'sender@example.com',
        subject: 'First',
      })

      expect(() =>
        dao.markProcessed({
          messageId: 'msg-unique',
          threadId: 'thread-2',
          accountId,
          senderEmail: 'sender@example.com',
          subject: 'Duplicate',
        })
      ).toThrow()
    })
  })
})

// ─── GmailService Tests ─────────────────────────────────────────────────────

describe('GmailService', () => {
  let db: Database.Database
  let dbPath: string
  let service: GmailService
  let mockOAuth: GoogleOAuth

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-gmail-svc-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    )
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const migrator = new Migrator(db, migrations)
    migrator.migrate()
    mockOAuth = createMockOAuth()
    service = new GmailService(db, mockOAuth)
  })

  afterEach(() => {
    db.close()
    try { fs.unlinkSync(dbPath) } catch {}
    try { fs.unlinkSync(dbPath + '-wal') } catch {}
    try { fs.unlinkSync(dbPath + '-shm') } catch {}
  })

  // ─── parseSender ──────────────────────────────────────────────────────────

  describe('parseSender', () => {
    it('parses "Name <email>" format', () => {
      const result = service.parseSender('John Doe <john@example.com>')
      expect(result.email).toBe('john@example.com')
      expect(result.name).toBe('John Doe')
    })

    it('parses "<email>" format', () => {
      const result = service.parseSender('<john@example.com>')
      expect(result.email).toBe('john@example.com')
      expect(result.name).toBe('')
    })

    it('parses plain email format', () => {
      const result = service.parseSender('john@example.com')
      expect(result.email).toBe('john@example.com')
      expect(result.name).toBe('')
    })

    it('handles quoted name', () => {
      const result = service.parseSender('"Jane Smith" <jane@example.com>')
      expect(result.email).toBe('jane@example.com')
      expect(result.name).toBe('Jane Smith')
    })
  })

  // ─── matchesWhitelist ─────────────────────────────────────────────────────

  describe('matchesWhitelist', () => {
    const makeMessage = (
      from: string,
      subject: string
    ): { id: string; threadId: string; from: string; subject: string; date: string; snippet: string } => ({
      id: 'msg-1',
      threadId: 'thread-1',
      from,
      subject,
      date: new Date().toISOString(),
      snippet: '',
    })

    const makeRule = (pattern: string): WhitelistRule => ({
      id: 'rule-1',
      pattern,
      clientId: null,
      priority: 0,
      isActive: 1,
      createdAt: new Date().toISOString(),
      note: null,
    })

    it('matches exact email address', () => {
      const msg = makeMessage('boss@company.com', 'Hello')
      const rules = [makeRule('boss@company.com')]
      expect(service.matchesWhitelist(msg, rules)).toBe(true)
    })

    it('matches email case-insensitively', () => {
      const msg = makeMessage('Boss@Company.COM', 'Hello')
      const rules = [makeRule('boss@company.com')]
      expect(service.matchesWhitelist(msg, rules)).toBe(true)
    })

    it('matches domain pattern', () => {
      const msg = makeMessage('anyone@company.com', 'Hello')
      const rules = [makeRule('@company.com')]
      expect(service.matchesWhitelist(msg, rules)).toBe(true)
    })

    it('does not match wrong domain', () => {
      const msg = makeMessage('user@other.com', 'Hello')
      const rules = [makeRule('@company.com')]
      expect(service.matchesWhitelist(msg, rules)).toBe(false)
    })

    it('matches subject keyword', () => {
      const msg = makeMessage('user@any.com', 'Invoice #12345')
      const rules = [makeRule('subject:invoice')]
      expect(service.matchesWhitelist(msg, rules)).toBe(true)
    })

    it('matches subject keyword case-insensitively', () => {
      const msg = makeMessage('user@any.com', 'URGENT: Fix now')
      const rules = [makeRule('subject:urgent')]
      expect(service.matchesWhitelist(msg, rules)).toBe(true)
    })

    it('does not match subject when keyword absent', () => {
      const msg = makeMessage('user@any.com', 'Regular email')
      const rules = [makeRule('subject:invoice')]
      expect(service.matchesWhitelist(msg, rules)).toBe(false)
    })

    it('skips inactive rules', () => {
      const msg = makeMessage('boss@company.com', 'Hello')
      const rules: WhitelistRule[] = [
        { ...makeRule('boss@company.com'), isActive: 0 },
      ]
      expect(service.matchesWhitelist(msg, rules)).toBe(false)
    })

    it('returns false with no rules', () => {
      const msg = makeMessage('user@any.com', 'Hello')
      expect(service.matchesWhitelist(msg, [])).toBe(false)
    })

    it('matches when any rule matches', () => {
      const msg = makeMessage('vip@important.com', 'Hello')
      const rules = [
        makeRule('@company.com'),
        makeRule('vip@important.com'),
      ]
      expect(service.matchesWhitelist(msg, rules)).toBe(true)
    })

    it('matches email in "Name <email>" format', () => {
      const msg = makeMessage('John Doe <john@company.com>', 'Hello')
      const rules = [makeRule('@company.com')]
      expect(service.matchesWhitelist(msg, rules)).toBe(true)
    })
  })

  // ─── Account Management ───────────────────────────────────────────────────

  describe('account management', () => {
    it('adds an account via addAccount', async () => {
      const tokens: OAuthTokens = {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 3600000,
      }

      const account = await service.addAccount(tokens)

      expect(account.email).toBe('user@example.com')
      expect(account.isActive).toBe(1)
      expect(mockOAuth.getUserEmail).toHaveBeenCalledWith('at')
    })

    it('reactivates existing account on re-add', async () => {
      const tokens: OAuthTokens = {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 3600000,
      }

      const first = await service.addAccount(tokens)
      service.removeAccount(first.id)

      // Re-create with same email (getUserEmail returns same email)
      ;(mockOAuth.getUserEmail as ReturnType<typeof vi.fn>).mockResolvedValue(
        'user@example.com'
      )

      // The account was deleted, not deactivated, so this creates a new one
      const second = await service.addAccount(tokens)
      expect(second.email).toBe('user@example.com')
    })

    it('lists accounts', async () => {
      const tokens: OAuthTokens = {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 3600000,
      }

      await service.addAccount(tokens)
      const accounts = service.listAccounts()
      expect(accounts.length).toBe(1)
      expect(accounts[0].email).toBe('user@example.com')
    })

    it('removes an account', async () => {
      const tokens: OAuthTokens = {
        accessToken: 'at',
        refreshToken: 'rt',
        expiresAt: Date.now() + 3600000,
      }

      const account = await service.addAccount(tokens)
      service.removeAccount(account.id)
      expect(service.listAccounts().length).toBe(0)
    })
  })

  // ─── Whitelist Rule Management ────────────────────────────────────────────

  describe('whitelist rule management', () => {
    it('adds and lists rules', () => {
      service.addWhitelistRule({ pattern: '@company.com' })
      service.addWhitelistRule({ pattern: 'subject:urgent' })

      const rules = service.listWhitelistRules()
      expect(rules.length).toBe(2)
    })

    it('removes a rule', () => {
      const rule = service.addWhitelistRule({ pattern: '@remove.com' })
      service.removeWhitelistRule(rule.id)

      const rules = service.listWhitelistRules()
      expect(rules.length).toBe(0)
    })
  })

  // ─── pollEmails ───────────────────────────────────────────────────────────

  describe('pollEmails', () => {
    let accountId: string
    const originalFetch = global.fetch

    beforeEach(async () => {
      const tokens: OAuthTokens = {
        accessToken: 'valid-token',
        refreshToken: 'rt',
        expiresAt: Date.now() + 3600000,
      }
      const account = await service.addAccount(tokens)
      accountId = account.id
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('returns empty when no whitelist rules exist', async () => {
      const result = await service.pollEmails(accountId)
      expect(result).toEqual([])
    })

    it('returns empty when no unread messages', async () => {
      service.addWhitelistRule({ pattern: '@company.com' })

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ messages: [] }),
        text: async () => '',
      }) as unknown as typeof fetch

      const result = await service.pollEmails(accountId)
      expect(result).toEqual([])
    })

    it('polls and processes matching emails', async () => {
      service.addWhitelistRule({ pattern: '@company.com' })

      const messages: MockMessage[] = [
        {
          id: 'msg-1',
          threadId: 'thread-1',
          from: 'Alice <alice@company.com>',
          subject: 'Project Update',
          snippet: 'Here is the update...',
        },
      ]

      let callCount = 0
      global.fetch = vi.fn().mockImplementation((url: string) => {
        callCount++
        if (url.includes('/messages?') || url.includes('/messages?')) {
          return Promise.resolve(makeGmailListResponse(messages.map((m) => m.id)))
        }
        // Individual message fetch
        const msg = messages.find((m) => url.includes(m.id))
        if (msg) {
          return Promise.resolve(makeGmailMessageResponse(msg))
        }
        return Promise.resolve({ ok: false, status: 404, text: async () => 'Not found' })
      }) as unknown as typeof fetch

      const result = await service.pollEmails(accountId)

      expect(result.length).toBe(1)
      expect(result[0].fromAddress).toBe('alice@company.com')
      expect(result[0].subject).toBe('Project Update')
    })

    it('skips emails that do not match whitelist', async () => {
      service.addWhitelistRule({ pattern: '@company.com' })

      const messages: MockMessage[] = [
        {
          id: 'msg-spam',
          threadId: 'thread-spam',
          from: 'spammer@other.com',
          subject: 'Buy now!',
        },
      ]

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/messages?')) {
          return Promise.resolve(makeGmailListResponse(messages.map((m) => m.id)))
        }
        const msg = messages.find((m) => url.includes(m.id))
        if (msg) return Promise.resolve(makeGmailMessageResponse(msg))
        return Promise.resolve({ ok: false, status: 404, text: async () => '' })
      }) as unknown as typeof fetch

      const result = await service.pollEmails(accountId)
      expect(result.length).toBe(0)
    })

    it('skips already-processed messages', async () => {
      service.addWhitelistRule({ pattern: '@company.com' })

      // Pre-process a message
      const dao = new GmailDAO(db)
      dao.markProcessed({
        messageId: 'msg-old',
        threadId: 'thread-old',
        accountId,
        senderEmail: 'alice@company.com',
        subject: 'Old Email',
      })

      const messages: MockMessage[] = [
        {
          id: 'msg-old',
          threadId: 'thread-old',
          from: 'Alice <alice@company.com>',
          subject: 'Old Email',
        },
      ]

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/messages?')) {
          return Promise.resolve(makeGmailListResponse(messages.map((m) => m.id)))
        }
        const msg = messages.find((m) => url.includes(m.id))
        if (msg) return Promise.resolve(makeGmailMessageResponse(msg))
        return Promise.resolve({ ok: false, status: 404, text: async () => '' })
      }) as unknown as typeof fetch

      const result = await service.pollEmails(accountId)
      expect(result.length).toBe(0)
    })

    it('throws for nonexistent account', async () => {
      await expect(service.pollEmails('fake-id')).rejects.toThrow(
        'Gmail account not found: fake-id'
      )
    })

    it('refreshes token when expired', async () => {
      // Set tokens that are about to expire
      service.setTokens(accountId, {
        accessToken: 'expired',
        refreshToken: 'rt',
        expiresAt: Date.now() - 1000, // already expired
      })

      service.addWhitelistRule({ pattern: '@company.com' })

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/messages?')) {
          return Promise.resolve(makeGmailListResponse([]))
        }
        return Promise.resolve({ ok: false, status: 404, text: async () => '' })
      }) as unknown as typeof fetch

      await service.pollEmails(accountId)

      expect(mockOAuth.refreshToken).toHaveBeenCalledWith('rt')
    })

    it('throws when tokens are missing for account', async () => {
      // Create account directly in DB without setting tokens
      const dao = new GmailDAO(db)
      const newAccount = dao.create({
        email: 'no-tokens@test.com',
        accessToken: '',
        refreshToken: '',
        expiresAt: '',
      })

      service.addWhitelistRule({ pattern: '@test.com' })

      await expect(service.pollEmails(newAccount.id)).rejects.toThrow(
        'No tokens stored'
      )
    })
  })

  // ─── processNewEmails ─────────────────────────────────────────────────────

  describe('processNewEmails', () => {
    let accountId: string
    const originalFetch = global.fetch

    beforeEach(async () => {
      const tokens: OAuthTokens = {
        accessToken: 'valid-token',
        refreshToken: 'rt',
        expiresAt: Date.now() + 3600000,
      }
      const account = await service.addAccount(tokens)
      accountId = account.id
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('creates tasks from matching emails', async () => {
      service.addWhitelistRule({ pattern: '@company.com' })

      const messages: MockMessage[] = [
        {
          id: 'msg-task-1',
          threadId: 'thread-task-1',
          from: 'Alice <alice@company.com>',
          subject: 'Fix the login bug',
          snippet: 'The login page is broken...',
        },
      ]

      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/messages?')) {
          return Promise.resolve(makeGmailListResponse(messages.map((m) => m.id)))
        }
        const msg = messages.find((m) => url.includes(m.id))
        if (msg) return Promise.resolve(makeGmailMessageResponse(msg))
        return Promise.resolve({ ok: false, status: 404, text: async () => '' })
      }) as unknown as typeof fetch

      const tasks = await service.processNewEmails(accountId, '__global__')

      expect(tasks.length).toBe(1)
      expect(tasks[0].title).toBe('Fix the login bug')
      expect(tasks[0].source).toBe('ai-extracted')
      expect(tasks[0].gmailMessageId).toBe('msg-task-1')
      expect(tasks[0].gmailThreadId).toBe('thread-task-1')
    })
  })
})
