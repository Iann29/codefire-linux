import { app, safeStorage } from 'electron'
import path from 'path'
import fs from 'fs'

export interface StoredToken {
  accessToken: string
  refreshToken: string | null
  expiresAt: number // unix ms
  scope: string
  accountEmail: string | null
  accountName: string | null
  providerId: string
  createdAt: number
  /** Subscription tier detected from profile API (e.g. "Pro", "Max", "Plus", "Advanced") */
  subscriptionTier: string | null
}

interface EncryptedEntry {
  data: string // base64 of safeStorage-encrypted buffer
  providerId: string
}

interface TokenFile {
  version: 1
  entries: Record<string, EncryptedEntry>
}

const TOKEN_FILE = 'tokens.enc.json'
const REFRESH_BUFFER_MS = 5 * 60 * 1000 // refresh 5min before expiry

function getTokenPath(): string {
  return path.join(app.getPath('userData'), TOKEN_FILE)
}

function readTokenFile(): TokenFile {
  try {
    const raw = fs.readFileSync(getTokenPath(), 'utf-8')
    return JSON.parse(raw) as TokenFile
  } catch {
    return { version: 1, entries: {} }
  }
}

function writeTokenFile(file: TokenFile): void {
  const dir = path.dirname(getTokenPath())
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(getTokenPath(), JSON.stringify(file, null, 2), { mode: 0o600 })
}

/** Build the storage key for a provider account: `providerId::index` */
function storageKey(providerId: string, index: number): string {
  return `${providerId}::${index}`
}

/** Parse a storage key back into providerId and index (backward compat: keys without '::' are index 0) */
function parseStorageKey(key: string): { providerId: string; index: number } {
  const sep = key.lastIndexOf('::')
  if (sep === -1) {
    return { providerId: key, index: 0 }
  }
  const maybeIndex = Number(key.slice(sep + 2))
  if (Number.isNaN(maybeIndex)) {
    // Not a numeric suffix — treat whole key as providerId, index 0
    return { providerId: key, index: 0 }
  }
  return { providerId: key.slice(0, sep), index: maybeIndex }
}

export class TokenStore {
  private cache = new Map<string, StoredToken>()

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  // ── Migration: ensure legacy keys (without ::) are migrated to ::0 ──────

  private migrateIfNeeded(file: TokenFile): boolean {
    let migrated = false
    const keys = Object.keys(file.entries)
    for (const key of keys) {
      if (!key.includes('::')) {
        // Legacy key — migrate to ::0
        const newKey = storageKey(key, 0)
        if (!file.entries[newKey]) {
          file.entries[newKey] = file.entries[key]
          delete file.entries[key]
          migrated = true
        }
      }
    }
    return migrated
  }

  private readAndMigrate(): TokenFile {
    const file = readTokenFile()
    if (this.migrateIfNeeded(file)) {
      writeTokenFile(file)
    }
    return file
  }

  // ── Core CRUD ────────────────────────────────────────────────────────────

  /**
   * Add an account for a provider. If an account with the same email already
   * exists, it is overwritten (re-auth). Otherwise a new index is assigned.
   * Returns the account index.
   */
  addAccount(token: StoredToken): number {
    const file = this.readAndMigrate()

    // Check if an account with the same email already exists for this provider
    if (token.accountEmail) {
      const existing = this.findAccountByEmail(file, token.providerId, token.accountEmail)
      if (existing !== null) {
        this.saveEntry(file, token, existing)
        return existing
      }
    }

    // Find next available index
    const nextIndex = this.getNextIndex(file, token.providerId)
    this.saveEntry(file, token, nextIndex)
    return nextIndex
  }

  /**
   * Legacy save — overwrites account at index 0.
   * @deprecated Use addAccount() for multi-account support.
   */
  save(token: StoredToken): void {
    const file = this.readAndMigrate()
    this.saveEntry(file, token, 0)
  }

  /**
   * Get a specific account by provider and index.
   * If index is omitted, returns the account at index 0 (backward compat).
   */
  getAccount(providerId: string, index: number = 0): StoredToken | null {
    const key = storageKey(providerId, index)

    // Check cache first
    const cached = this.cache.get(key)
    if (cached) return cached

    const file = this.readAndMigrate()
    const entry = file.entries[key]
    if (!entry) return null

    return this.decryptEntry(entry, key)
  }

  /**
   * Legacy get — returns account at index 0.
   */
  get(providerId: string): StoredToken | null {
    return this.getAccount(providerId, 0)
  }

  /**
   * Remove a specific account by provider and index.
   * If index is omitted, removes the account at index 0 (backward compat).
   */
  removeAccount(providerId: string, index: number = 0): void {
    const key = storageKey(providerId, index)
    this.cache.delete(key)
    const file = this.readAndMigrate()
    delete file.entries[key]
    writeTokenFile(file)
  }

  /**
   * Legacy remove — removes account at index 0.
   */
  remove(providerId: string): void {
    this.removeAccount(providerId, 0)
  }

  /**
   * Get all accounts for a given provider, sorted by index.
   */
  getAccounts(providerId: string): StoredToken[] {
    const file = this.readAndMigrate()
    const results: Array<{ index: number; token: StoredToken }> = []

    for (const key of Object.keys(file.entries)) {
      const parsed = parseStorageKey(key)
      if (parsed.providerId !== providerId) continue

      const token = this.getAccount(providerId, parsed.index)
      if (token) {
        results.push({ index: parsed.index, token })
      }
    }

    results.sort((a, b) => a.index - b.index)
    return results.map((r) => r.token)
  }

  /**
   * Get the number of accounts for a given provider.
   */
  getAccountCount(providerId: string): number {
    const file = this.readAndMigrate()
    let count = 0
    for (const key of Object.keys(file.entries)) {
      const parsed = parseStorageKey(key)
      if (parsed.providerId === providerId) count++
    }
    return count
  }

  /**
   * List all accounts across all providers.
   */
  listAccounts(): Array<{
    providerId: string
    accountIndex: number
    accountEmail: string | null
    accountName: string | null
    subscriptionTier: string | null
    expiresAt: number
    isExpired: boolean
    needsRefresh: boolean
  }> {
    const file = this.readAndMigrate()
    const results: Array<{
      providerId: string
      accountIndex: number
      accountEmail: string | null
      accountName: string | null
      subscriptionTier: string | null
      expiresAt: number
      isExpired: boolean
      needsRefresh: boolean
    }> = []

    for (const key of Object.keys(file.entries)) {
      const parsed = parseStorageKey(key)
      const token = this.getAccount(parsed.providerId, parsed.index)
      if (!token) continue

      const now = Date.now()
      results.push({
        providerId: token.providerId,
        accountIndex: parsed.index,
        accountEmail: token.accountEmail,
        accountName: token.accountName,
        subscriptionTier: token.subscriptionTier ?? null,
        expiresAt: token.expiresAt,
        isExpired: token.expiresAt > 0 && now >= token.expiresAt,
        needsRefresh: token.expiresAt > 0 && now >= token.expiresAt - REFRESH_BUFFER_MS,
      })
    }

    return results
  }

  /**
   * Check if a specific account needs token refresh.
   */
  needsRefresh(providerId: string, index: number = 0): boolean {
    const token = this.getAccount(providerId, index)
    if (!token) return false
    if (token.expiresAt <= 0) return false // no expiry
    return Date.now() >= token.expiresAt - REFRESH_BUFFER_MS
  }

  /**
   * Update just the access token and expiry for a specific account.
   */
  updateAccessToken(providerId: string, accessToken: string, expiresAt: number, index: number = 0): void {
    const existing = this.getAccount(providerId, index)
    if (!existing) return
    const file = this.readAndMigrate()
    this.saveEntry(file, { ...existing, accessToken, expiresAt }, index)
  }

  clearAll(): void {
    this.cache.clear()
    writeTokenFile({ version: 1, entries: {} })
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  private saveEntry(file: TokenFile, token: StoredToken, index: number): void {
    const json = JSON.stringify(token)
    const key = storageKey(token.providerId, index)

    let data: string
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(json)
      data = encrypted.toString('base64')
    } else {
      // Fallback: base64 only (less secure, but functional)
      data = Buffer.from(json).toString('base64')
    }

    file.entries[key] = { data, providerId: token.providerId }
    writeTokenFile(file)

    this.cache.set(key, token)
  }

  private decryptEntry(entry: EncryptedEntry, cacheKey: string): StoredToken | null {
    try {
      let json: string
      if (safeStorage.isEncryptionAvailable()) {
        const buf = Buffer.from(entry.data, 'base64')
        json = safeStorage.decryptString(buf)
      } else {
        json = Buffer.from(entry.data, 'base64').toString('utf-8')
      }

      const token = JSON.parse(json) as StoredToken
      this.cache.set(cacheKey, token)
      return token
    } catch {
      // Corrupted entry — remove it
      this.cache.delete(cacheKey)
      const file = readTokenFile()
      delete file.entries[cacheKey]
      writeTokenFile(file)
      return null
    }
  }

  private findAccountByEmail(file: TokenFile, providerId: string, email: string): number | null {
    for (const key of Object.keys(file.entries)) {
      const parsed = parseStorageKey(key)
      if (parsed.providerId !== providerId) continue

      const token = this.getAccount(providerId, parsed.index)
      if (token?.accountEmail === email) {
        return parsed.index
      }
    }
    return null
  }

  private getNextIndex(file: TokenFile, providerId: string): number {
    let maxIndex = -1
    for (const key of Object.keys(file.entries)) {
      const parsed = parseStorageKey(key)
      if (parsed.providerId === providerId && parsed.index > maxIndex) {
        maxIndex = parsed.index
      }
    }
    return maxIndex + 1
  }
}
