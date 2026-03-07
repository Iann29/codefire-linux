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

export class TokenStore {
  private cache = new Map<string, StoredToken>()

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }

  save(token: StoredToken): void {
    const json = JSON.stringify(token)

    let data: string
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(json)
      data = encrypted.toString('base64')
    } else {
      // Fallback: base64 only (less secure, but functional)
      data = Buffer.from(json).toString('base64')
    }

    const file = readTokenFile()
    file.entries[token.providerId] = { data, providerId: token.providerId }
    writeTokenFile(file)

    this.cache.set(token.providerId, token)
  }

  get(providerId: string): StoredToken | null {
    // Check cache first
    const cached = this.cache.get(providerId)
    if (cached) return cached

    const file = readTokenFile()
    const entry = file.entries[providerId]
    if (!entry) return null

    try {
      let json: string
      if (safeStorage.isEncryptionAvailable()) {
        const buf = Buffer.from(entry.data, 'base64')
        json = safeStorage.decryptString(buf)
      } else {
        json = Buffer.from(entry.data, 'base64').toString('utf-8')
      }

      const token = JSON.parse(json) as StoredToken
      this.cache.set(providerId, token)
      return token
    } catch {
      // Corrupted entry — remove it
      this.remove(providerId)
      return null
    }
  }

  remove(providerId: string): void {
    this.cache.delete(providerId)
    const file = readTokenFile()
    delete file.entries[providerId]
    writeTokenFile(file)
  }

  listAccounts(): Array<{
    providerId: string
    accountEmail: string | null
    accountName: string | null
    expiresAt: number
    isExpired: boolean
    needsRefresh: boolean
  }> {
    const file = readTokenFile()
    const results: Array<{
      providerId: string
      accountEmail: string | null
      accountName: string | null
      expiresAt: number
      isExpired: boolean
      needsRefresh: boolean
    }> = []

    for (const providerId of Object.keys(file.entries)) {
      const token = this.get(providerId)
      if (!token) continue

      const now = Date.now()
      results.push({
        providerId: token.providerId,
        accountEmail: token.accountEmail,
        accountName: token.accountName,
        expiresAt: token.expiresAt,
        isExpired: token.expiresAt > 0 && now >= token.expiresAt,
        needsRefresh: token.expiresAt > 0 && now >= token.expiresAt - REFRESH_BUFFER_MS,
      })
    }

    return results
  }

  needsRefresh(providerId: string): boolean {
    const token = this.get(providerId)
    if (!token) return false
    if (token.expiresAt <= 0) return false // no expiry
    return Date.now() >= token.expiresAt - REFRESH_BUFFER_MS
  }

  updateAccessToken(providerId: string, accessToken: string, expiresAt: number): void {
    const existing = this.get(providerId)
    if (!existing) return
    this.save({ ...existing, accessToken, expiresAt })
  }

  clearAll(): void {
    this.cache.clear()
    writeTokenFile({ version: 1, entries: {} })
  }
}
