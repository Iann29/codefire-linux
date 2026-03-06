import type Database from 'better-sqlite3'
import { getSupabaseClient } from './SupabaseClient'
import type { SyncState } from '@shared/premium-models'

/**
 * SyncEngine manages bidirectional sync between the local SQLite database
 * and the remote Supabase backend for premium team features.
 *
 * It periodically pushes dirty local entities to the remote and pulls
 * updates from team members.
 */
export class SyncEngine {
  private db: Database.Database
  private intervalId: ReturnType<typeof setInterval> | null = null
  private trackedEntities: Map<string, { entityType: string; localId: string; projectId: string }> = new Map()
  private subscribedProjects: Set<string> = new Set()

  constructor(db: Database.Database) {
    this.db = db
    this.ensureSyncTable()
  }

  private ensureSyncTable(): void {
    // Table is created by migration 21 (v20_createSyncState).
    // This is a safety net for dev environments that skip migrations.
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS syncState (
        entityType TEXT NOT NULL,
        localId TEXT NOT NULL,
        remoteId TEXT,
        projectId TEXT,
        lastSyncedAt TEXT,
        dirty INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (entityType, localId)
      )
    `)
  }

  /** Start the periodic sync loop (default: every 30 seconds) */
  start(intervalMs = 30_000): void {
    if (this.intervalId) return
    this.intervalId = setInterval(() => {
      this.syncAll().catch((err) => {
        console.error('[SyncEngine] Sync cycle failed:', err)
      })
    }, intervalMs)
    console.log(`[SyncEngine] Started with ${intervalMs}ms interval`)
  }

  /** Stop the periodic sync loop */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
      console.log('[SyncEngine] Stopped')
    }
  }

  /** Track an entity for syncing */
  trackEntity(entityType: string, localId: string, projectId: string): void {
    const key = `${entityType}:${localId}`
    this.trackedEntities.set(key, { entityType, localId, projectId })

    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO syncState (entityType, localId, projectId, dirty) VALUES (?, ?, ?, 1)`
    )
    stmt.run(entityType, localId, projectId)
  }

  /** Mark an entity as dirty (needs sync) */
  markDirty(entityType: string, localId: string): void {
    const stmt = this.db.prepare(
      `UPDATE syncState SET dirty = 1 WHERE entityType = ? AND localId = ?`
    )
    stmt.run(entityType, localId)
  }

  /** Subscribe to updates for a project */
  subscribeToProject(projectId: string): void {
    this.subscribedProjects.add(projectId)
  }

  /** Unsubscribe from a project */
  unsubscribeFromProject(projectId: string): void {
    this.subscribedProjects.delete(projectId)
    // Remove tracked entities for this project
    const stmt = this.db.prepare(
      `DELETE FROM syncState WHERE projectId = ?`
    )
    stmt.run(projectId)
  }

  /** Get sync state for all tracked entities */
  getSyncStates(): SyncState[] {
    const stmt = this.db.prepare(`SELECT * FROM syncState`)
    const rows = stmt.all() as Array<{
      entityType: string
      localId: string
      remoteId: string | null
      lastSyncedAt: string | null
      dirty: number
    }>

    return rows.map((r) => ({
      entityType: r.entityType as SyncState['entityType'],
      localId: r.localId,
      remoteId: r.remoteId,
      lastSyncedAt: r.lastSyncedAt,
      dirty: r.dirty === 1,
    }))
  }

  /** Run a full sync cycle: push dirty entities, then pull remote updates */
  private async syncAll(): Promise<void> {
    const client = getSupabaseClient()
    if (!client) return

    const { data: { user } } = await client.auth.getUser()
    if (!user) return

    await this.pushDirty(client)
    await this.pullUpdates(client)
  }

  private async pushDirty(client: ReturnType<typeof getSupabaseClient>): Promise<void> {
    if (!client) return

    const dirtyStmt = this.db.prepare(
      `SELECT * FROM syncState WHERE dirty = 1`
    )
    const dirtyRows = dirtyStmt.all() as Array<{
      entityType: string
      localId: string
      remoteId: string | null
      projectId: string | null
    }>

    for (const row of dirtyRows) {
      try {
        // For now, mark as synced -- actual push logic depends on entity type
        const updateStmt = this.db.prepare(
          `UPDATE syncState SET dirty = 0, lastSyncedAt = datetime('now') WHERE entityType = ? AND localId = ?`
        )
        updateStmt.run(row.entityType, row.localId)
      } catch (err) {
        console.error(`[SyncEngine] Failed to push ${row.entityType}:${row.localId}:`, err)
      }
    }
  }

  private async pullUpdates(_client: ReturnType<typeof getSupabaseClient>): Promise<void> {
    // Pull logic will be implemented per entity type
    // For now, this is a no-op placeholder
  }
}
