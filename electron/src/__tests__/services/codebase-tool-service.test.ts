import fs from 'fs'
import os from 'os'
import path from 'path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { Migrator } from '../../main/database/migrator'
import { migrations } from '../../main/database/migrations'
import { ChunkDAO } from '../../main/database/dao/ChunkDAO'
import { IndexDAO } from '../../main/database/dao/IndexDAO'
import { CodebaseToolService } from '../../main/services/tools/codebase/CodebaseToolService'

describe('CodebaseToolService', () => {
  let db: Database.Database
  let dbPath: string
  let projectRoot: string
  let projectId: string
  let indexDAO: IndexDAO
  let chunkDAO: ChunkDAO
  let service: CodebaseToolService

  beforeEach(() => {
    dbPath = path.join(
      os.tmpdir(),
      `test-codebase-tool-service-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
    )
    projectRoot = path.join(
      os.tmpdir(),
      `test-codebase-tool-project-${Date.now()}-${Math.random().toString(36).slice(2)}`
    )
    projectId = 'project-1'

    fs.mkdirSync(projectRoot, { recursive: true })
    db = new Database(dbPath)
    db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    new Migrator(db, migrations).migrate()

    db.prepare(
      `INSERT INTO projects (id, name, path, createdAt, sortOrder) VALUES (?, ?, ?, datetime('now'), 0)`
    ).run(projectId, 'Project', projectRoot)

    indexDAO = new IndexDAO(db)
    chunkDAO = new ChunkDAO(db)
    service = new CodebaseToolService(db)
  })

  afterEach(() => {
    db.close()
    try { fs.rmSync(projectRoot, { recursive: true, force: true }) } catch {}
    try { fs.unlinkSync(dbPath) } catch {}
    try { fs.unlinkSync(dbPath + '-wal') } catch {}
    try { fs.unlinkSync(dbPath + '-shm') } catch {}
  })

  function addIndexedFile(relativePath: string, language: string | null = 'typescript') {
    return indexDAO.upsertFile({
      projectId,
      relativePath,
      contentHash: `hash:${relativePath}`,
      language,
    })
  }

  function addChunk(args: {
    id: string
    relativePath: string
    chunkType?: string
    symbolName?: string | null
    content: string
    startLine?: number | null
    endLine?: number | null
  }) {
    const file = indexDAO.getFileByPath(projectId, args.relativePath) ?? addIndexedFile(args.relativePath)
    chunkDAO.insert({
      id: args.id,
      fileId: file.id,
      projectId,
      chunkType: args.chunkType ?? 'function',
      symbolName: args.symbolName ?? null,
      content: args.content,
      startLine: 'startLine' in args ? args.startLine ?? null : 1,
      endLine: 'endLine' in args ? args.endLine ?? null : 10,
      embedding: null,
    })
  }

  describe('findSymbol', () => {
    it('ranks exact symbol matches above qualified matches', async () => {
      addChunk({
        id: 'c1',
        relativePath: 'src/services/UserService.ts',
        chunkType: 'class',
        symbolName: 'UserService',
        content: 'export class UserService {}',
      })
      addChunk({
        id: 'c2',
        relativePath: 'src/services/UserService.ts',
        chunkType: 'function',
        symbolName: 'UserService.loadUser',
        content: 'loadUser() { return fetch("/user") }',
      })

      const result = await service.findSymbol({
        projectId,
        query: 'UserService',
      })

      expect(result.ok).toBe(true)
      const matches = (result.data as { matches: Array<Record<string, unknown>> }).matches
      expect(matches[0]).toMatchObject({
        symbol: 'UserService',
        path: 'src/services/UserService.ts',
        matchKind: 'exact',
      })
      expect(matches[1]).toMatchObject({
        symbol: 'UserService.loadUser',
      })
    })

    it('supports type filters', async () => {
      addChunk({
        id: 'class-1',
        relativePath: 'src/services/AuthService.ts',
        chunkType: 'class',
        symbolName: 'AuthService',
        content: 'export class AuthService {}',
      })
      addChunk({
        id: 'function-1',
        relativePath: 'src/services/AuthService.ts',
        chunkType: 'function',
        symbolName: 'AuthService.login',
        content: 'login() { return true }',
      })

      const result = await service.findSymbol({
        projectId,
        query: 'AuthService',
        types: ['class'],
      })

      expect(result.ok).toBe(true)
      const matches = (result.data as { matches: Array<Record<string, unknown>> }).matches
      expect(matches).toHaveLength(1)
      expect(matches[0]).toMatchObject({
        symbol: 'AuthService',
        chunkType: 'class',
      })
    })
  })

  describe('findRelatedFiles', () => {
    it('prioritizes sibling counterpart files for a path seed', async () => {
      addIndexedFile('src/components/Button.tsx')
      addIndexedFile('src/components/Button.test.tsx')
      addIndexedFile('src/components/Button.stories.tsx')
      addIndexedFile('src/components/Card.tsx')
      addIndexedFile('src/pages/Home.tsx')

      const result = await service.findRelatedFiles({
        projectId,
        projectPath: projectRoot,
        path: 'src/components/Button.tsx',
      })

      expect(result.ok).toBe(true)
      const relatedFiles = (result.data as { relatedFiles: Array<Record<string, unknown>> }).relatedFiles
      expect(relatedFiles[0]).toMatchObject({
        path: 'src/components/Button.stories.tsx',
      })
      expect(relatedFiles[1]).toMatchObject({
        path: 'src/components/Button.test.tsx',
      })
    })

    it('uses symbol and content references to rank related files', async () => {
      addChunk({
        id: 'sym-1',
        relativePath: 'src/hooks/useCheckout.ts',
        chunkType: 'function',
        symbolName: 'useCheckout',
        content: 'export function useCheckout() { return {} }',
      })
      addChunk({
        id: 'hit-1',
        relativePath: 'src/pages/CheckoutPage.tsx',
        chunkType: 'function',
        symbolName: 'CheckoutPage',
        content: 'import { useCheckout } from "../hooks/useCheckout"\nexport function CheckoutPage() { useCheckout(); return null }',
      })
      addChunk({
        id: 'hit-2',
        relativePath: 'src/components/CheckoutButton.tsx',
        chunkType: 'function',
        symbolName: 'CheckoutButton',
        content: 'export function CheckoutButton() { const checkout = useCheckout(); return checkout }',
      })
      addChunk({
        id: 'miss-1',
        relativePath: 'src/components/Header.tsx',
        chunkType: 'function',
        symbolName: 'Header',
        content: 'export function Header() { return null }',
      })

      const result = await service.findRelatedFiles({
        projectId,
        projectPath: projectRoot,
        symbol: 'useCheckout',
      })

      expect(result.ok).toBe(true)
      const payload = result.data as {
        seedPaths: string[]
        relatedFiles: Array<{ path: string; reasons: string[] }>
      }

      expect(payload.seedPaths).toContain('src/hooks/useCheckout.ts')
      expect(payload.relatedFiles.slice(0, 2).map((item) => item.path)).toEqual([
        'src/components/CheckoutButton.tsx',
        'src/pages/CheckoutPage.tsx',
      ])
      expect(payload.relatedFiles[0].reasons).toContain('content-hit')
    })
  })
})
