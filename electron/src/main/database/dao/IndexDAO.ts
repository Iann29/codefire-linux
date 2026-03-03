import Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import type { IndexedFile, IndexState, IndexRequest } from '@shared/models'

/**
 * DAO for managing indexedFiles, indexState, and indexRequests tables.
 *
 * Used by the ContextEngine to track which files have been indexed,
 * the current indexing state, and pending index requests.
 */
export class IndexDAO {
  constructor(private db: Database.Database) {}

  // ─── IndexedFiles ────────────────────────────────────────────────────────

  /**
   * Get an indexed file by project and relative path.
   */
  getFileByPath(
    projectId: string,
    relativePath: string
  ): IndexedFile | undefined {
    return this.db
      .prepare(
        'SELECT * FROM indexedFiles WHERE projectId = ? AND relativePath = ?'
      )
      .get(projectId, relativePath) as IndexedFile | undefined
  }

  /**
   * Insert or update an indexed file record.
   * Returns the upserted file.
   */
  upsertFile(file: {
    projectId: string
    relativePath: string
    contentHash: string
    language: string | null
  }): IndexedFile {
    const now = new Date().toISOString()
    const existing = this.getFileByPath(file.projectId, file.relativePath)

    if (existing) {
      this.db
        .prepare(
          `UPDATE indexedFiles
           SET contentHash = ?, language = ?, lastIndexedAt = ?
           WHERE id = ?`
        )
        .run(file.contentHash, file.language, now, existing.id)
      return this.getFileByPath(file.projectId, file.relativePath)!
    }

    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO indexedFiles (id, projectId, relativePath, contentHash, language, lastIndexedAt)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, file.projectId, file.relativePath, file.contentHash, file.language, now)
    return this.getFileByPath(file.projectId, file.relativePath)!
  }

  /**
   * Delete a single indexed file by id.
   */
  deleteFile(id: string): void {
    this.db.prepare('DELETE FROM indexedFiles WHERE id = ?').run(id)
  }

  /**
   * Delete indexed files that are no longer present in the project.
   * Keeps only files whose relativePath is in currentPaths.
   */
  deleteStaleFiles(projectId: string, currentPaths: string[]): void {
    if (currentPaths.length === 0) {
      // If there are no current paths, delete everything for this project
      this.db
        .prepare('DELETE FROM indexedFiles WHERE projectId = ?')
        .run(projectId)
      return
    }

    // Get all indexed files for this project
    const allFiles = this.db
      .prepare('SELECT id, relativePath FROM indexedFiles WHERE projectId = ?')
      .all(projectId) as { id: string; relativePath: string }[]

    const pathSet = new Set(currentPaths)
    const staleIds = allFiles
      .filter((f) => !pathSet.has(f.relativePath))
      .map((f) => f.id)

    if (staleIds.length === 0) return

    // Delete stale files in batches
    const deleteStmt = this.db.prepare(
      'DELETE FROM indexedFiles WHERE id = ?'
    )
    const deleteTransaction = this.db.transaction((ids: string[]) => {
      for (const id of ids) {
        deleteStmt.run(id)
      }
    })
    deleteTransaction(staleIds)
  }

  /**
   * List all indexed files for a project.
   */
  listByProject(projectId: string): IndexedFile[] {
    return this.db
      .prepare('SELECT * FROM indexedFiles WHERE projectId = ?')
      .all(projectId) as IndexedFile[]
  }

  // ─── IndexState ──────────────────────────────────────────────────────────

  /**
   * Get the current index state for a project.
   */
  getState(projectId: string): IndexState | undefined {
    return this.db
      .prepare('SELECT * FROM indexState WHERE projectId = ?')
      .get(projectId) as IndexState | undefined
  }

  /**
   * Upsert the index state for a project.
   */
  updateState(
    projectId: string,
    state: Partial<IndexState>
  ): void {
    const existing = this.getState(projectId)

    if (existing) {
      const fields: string[] = []
      const values: unknown[] = []

      if (state.status !== undefined) {
        fields.push('status = ?')
        values.push(state.status)
      }
      if (state.lastFullIndexAt !== undefined) {
        fields.push('lastFullIndexAt = ?')
        values.push(state.lastFullIndexAt)
      }
      if (state.totalChunks !== undefined) {
        fields.push('totalChunks = ?')
        values.push(state.totalChunks)
      }
      if (state.lastError !== undefined) {
        fields.push('lastError = ?')
        values.push(state.lastError)
      }

      if (fields.length > 0) {
        values.push(projectId)
        this.db
          .prepare(`UPDATE indexState SET ${fields.join(', ')} WHERE projectId = ?`)
          .run(...values)
      }
    } else {
      this.db
        .prepare(
          `INSERT INTO indexState (projectId, status, lastFullIndexAt, totalChunks, lastError)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          projectId,
          state.status ?? 'idle',
          state.lastFullIndexAt ?? null,
          state.totalChunks ?? 0,
          state.lastError ?? null
        )
    }
  }

  // ─── IndexRequests ───────────────────────────────────────────────────────

  /**
   * Get the next pending index request.
   */
  getPendingRequest(): IndexRequest | undefined {
    return this.db
      .prepare(
        `SELECT * FROM indexRequests WHERE status = 'pending' ORDER BY createdAt ASC LIMIT 1`
      )
      .get() as IndexRequest | undefined
  }

  /**
   * Create a new index request for a project.
   */
  createRequest(projectId: string, projectPath: string): void {
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO indexRequests (projectId, projectPath, status, createdAt)
         VALUES (?, ?, 'pending', ?)`
      )
      .run(projectId, projectPath, now)
  }

  /**
   * Mark a request as processing.
   */
  markProcessing(id: number): void {
    this.db
      .prepare(`UPDATE indexRequests SET status = 'processing' WHERE id = ?`)
      .run(id)
  }

  /**
   * Mark a request as completed.
   */
  markCompleted(id: number): void {
    this.db
      .prepare(`UPDATE indexRequests SET status = 'done' WHERE id = ?`)
      .run(id)
  }
}
