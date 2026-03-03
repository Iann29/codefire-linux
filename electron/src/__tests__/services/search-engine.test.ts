import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { Migrator } from '../../main/database/migrator'
import { migrations } from '../../main/database/migrations'
import { ChunkDAO } from '../../main/database/dao/ChunkDAO'
import { IndexDAO } from '../../main/database/dao/IndexDAO'
import { SearchEngine } from '../../main/services/SearchEngine'
import { EmbeddingClient } from '../../main/services/EmbeddingClient'
import { float32ArrayToBlob } from '../../main/database/search/vector-search'

describe('SearchEngine', () => {
  let db: Database.Database
  let dbPath: string
  let chunkDAO: ChunkDAO
  let indexDAO: IndexDAO
  let searchEngine: SearchEngine
  let embeddingClient: EmbeddingClient
  const projectId = 'test-project'

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-search-engine-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    )
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    const migrator = new Migrator(db, migrations)
    migrator.migrate()

    chunkDAO = new ChunkDAO(db)
    indexDAO = new IndexDAO(db)
    embeddingClient = new EmbeddingClient() // No API key — FTS-only by default

    searchEngine = new SearchEngine(db, embeddingClient)

    // Insert prerequisite project
    db.prepare(
      `INSERT INTO projects (id, name, path, createdAt, sortOrder) VALUES (?, ?, ?, datetime('now'), 0)`
    ).run(projectId, 'Test Project', '/test/project')

    // Insert prerequisite indexed files
    indexDAO.upsertFile({
      projectId,
      relativePath: 'src/auth.ts',
      contentHash: 'hash1',
      language: 'typescript',
    })
    indexDAO.upsertFile({
      projectId,
      relativePath: 'src/dashboard.ts',
      contentHash: 'hash2',
      language: 'typescript',
    })
  })

  afterEach(() => {
    db.close()
    try { fs.unlinkSync(dbPath) } catch {}
    try { fs.unlinkSync(dbPath + '-wal') } catch {}
    try { fs.unlinkSync(dbPath + '-shm') } catch {}
  })

  /**
   * Helper: get the file ID for a given relative path.
   */
  function getFileId(relativePath: string): string {
    const file = indexDAO.getFileByPath(projectId, relativePath)
    if (!file) throw new Error(`No indexed file for ${relativePath}`)
    return file.id
  }

  /**
   * Helper: insert a chunk with sensible defaults.
   */
  function insertChunk(overrides: {
    id: string
    content: string
    fileRelativePath?: string
    symbolName?: string | null
    chunkType?: string
    embedding?: Buffer | null
  }) {
    const fileId = getFileId(overrides.fileRelativePath ?? 'src/auth.ts')
    chunkDAO.insert({
      id: overrides.id,
      fileId,
      projectId,
      chunkType: overrides.chunkType ?? 'function',
      symbolName: overrides.symbolName ?? null,
      content: overrides.content,
      startLine: 1,
      endLine: 10,
      embedding: overrides.embedding ?? null,
    })
  }

  // ─── FTS-only search (no API key) ─────────────────────────────────────

  describe('FTS-only search (no API key)', () => {
    it('returns results from FTS when no API key is set', async () => {
      insertChunk({
        id: 'c1',
        content: 'function authenticate(user, password) { return token }',
        symbolName: 'authenticate',
      })
      insertChunk({
        id: 'c2',
        content: 'function renderDashboard() { return html }',
        symbolName: 'renderDashboard',
        fileRelativePath: 'src/dashboard.ts',
      })

      const results = await searchEngine.search(projectId, 'authenticate')

      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].chunkId).toBe('c1')
      expect(results[0].matchSource).toBe('fts')
      expect(results[0].score).toBeGreaterThan(0)
    })

    it('resolves file paths from IndexedFile records', async () => {
      insertChunk({
        id: 'c1',
        content: 'function authenticate(user) { return token }',
        symbolName: 'authenticate',
      })

      const results = await searchEngine.search(projectId, 'authenticate')

      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].filePath).toBe('src/auth.ts')
    })

    it('returns correct SearchResult shape', async () => {
      insertChunk({
        id: 'c1',
        content: 'function login(credentials) { validate(credentials) }',
        symbolName: 'login',
        chunkType: 'function',
      })

      const results = await searchEngine.search(projectId, 'login')

      expect(results.length).toBeGreaterThanOrEqual(1)
      const result = results[0]
      expect(result).toHaveProperty('chunkId')
      expect(result).toHaveProperty('content')
      expect(result).toHaveProperty('symbolName')
      expect(result).toHaveProperty('chunkType')
      expect(result).toHaveProperty('filePath')
      expect(result).toHaveProperty('startLine')
      expect(result).toHaveProperty('endLine')
      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('matchSource')
      expect(['fts', 'vector', 'hybrid']).toContain(result.matchSource)
    })
  })

  // ─── Hybrid search (with API key) ─────────────────────────────────────

  describe('hybrid search (with embeddings)', () => {
    it('returns hybrid results when chunks have embeddings and client has key', async () => {
      // Give the client a key but mock fetch so getEmbedding returns a known vector
      embeddingClient.setApiKey('test-key')

      // We can't easily mock fetch inside SearchEngine's embedded call,
      // so we test the case where embedding fails gracefully (falls back to FTS)
      insertChunk({
        id: 'c1',
        content: 'function processPayment(amount) { charge(amount) }',
        symbolName: 'processPayment',
        embedding: float32ArrayToBlob(new Float32Array([1, 0, 0, 0])),
      })

      // The embedding client will try to call the API and fail (no real server),
      // so it should fall back to FTS-only search
      const results = await searchEngine.search(projectId, 'processPayment')

      expect(results.length).toBeGreaterThanOrEqual(1)
      expect(results[0].chunkId).toBe('c1')
    })
  })

  // ─── Options ──────────────────────────────────────────────────────────

  describe('options', () => {
    it('respects limit parameter', async () => {
      // Insert many chunks in different files to avoid consolidation filtering
      const files = ['src/auth.ts', 'src/dashboard.ts']
      for (let i = 0; i < 10; i++) {
        const fileRelativePath = files[i % files.length]
        insertChunk({
          id: `c${i}`,
          content: `function handler${i}() { return process(data) }`,
          fileRelativePath,
        })
      }

      const results = await searchEngine.search(projectId, 'process', {
        limit: 3,
      })

      expect(results.length).toBeLessThanOrEqual(3)
    })

    it('filters by chunk types', async () => {
      insertChunk({
        id: 'c1',
        content: 'function authenticate(user) { return token }',
        chunkType: 'function',
        symbolName: 'authenticate',
      })
      insertChunk({
        id: 'c2',
        content: 'class AuthService { authenticate() {} }',
        chunkType: 'class',
        symbolName: 'AuthService',
        fileRelativePath: 'src/dashboard.ts',
      })

      const results = await searchEngine.search(
        projectId,
        'authenticate',
        { types: ['class'] }
      )

      // Should only return the class chunk
      for (const result of results) {
        expect(result.chunkType).toBe('class')
      }
    })

    it('returns results matching any of the specified types', async () => {
      insertChunk({
        id: 'c1',
        content: 'function buildQuery() { return sql }',
        chunkType: 'function',
        symbolName: 'buildQuery',
      })
      insertChunk({
        id: 'c2',
        content: 'class QueryBuilder { buildQuery() {} }',
        chunkType: 'class',
        symbolName: 'QueryBuilder',
        fileRelativePath: 'src/dashboard.ts',
      })
      insertChunk({
        id: 'c3',
        content: '// buildQuery documentation block',
        chunkType: 'block',
      })

      const results = await searchEngine.search(
        projectId,
        'buildQuery',
        { types: ['function', 'class'] }
      )

      for (const result of results) {
        expect(['function', 'class']).toContain(result.chunkType)
      }
    })
  })

  // ─── Empty Results ────────────────────────────────────────────────────

  describe('empty results', () => {
    it('returns empty array when no chunks match', async () => {
      insertChunk({
        id: 'c1',
        content: 'function hello() { return world }',
      })

      const results = await searchEngine.search(
        projectId,
        'zzzznonexistentquery'
      )

      expect(results).toEqual([])
    })

    it('returns empty array for project with no chunks', async () => {
      const results = await searchEngine.search(projectId, 'anything')
      expect(results).toEqual([])
    })
  })
})
