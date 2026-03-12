import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import type { Recording } from '@shared/models'

export class RecordingDAO {
  constructor(private db: Database.Database) {}

  list(projectId: string): Recording[] {
    return this.db
      .prepare('SELECT * FROM recordings WHERE projectId = ? ORDER BY createdAt DESC')
      .all(projectId) as Recording[]
  }

  getById(id: string): Recording | undefined {
    return this.db
      .prepare('SELECT * FROM recordings WHERE id = ?')
      .get(id) as Recording | undefined
  }

  create(data: {
    projectId: string
    title: string
    audioPath: string
  }): Recording {
    const id = randomUUID()
    const now = new Date().toISOString()
    this.db
      .prepare(
        `INSERT INTO recordings (id, projectId, title, audioPath, duration, status, createdAt)
         VALUES (?, ?, ?, ?, 0, 'recording', ?)`
      )
      .run(id, data.projectId, data.title, data.audioPath, now)
    return this.getById(id)!
  }

  update(
    id: string,
    data: {
      title?: string
      duration?: number
      transcript?: string
      transcriptionLanguage?: string
      transcribedAt?: string
      status?: string
      errorMessage?: string
    }
  ): Recording | undefined {
    const existing = this.getById(id)
    if (!existing) return undefined

    this.db
      .prepare(
        `UPDATE recordings SET title = ?, duration = ?, transcript = ?, transcriptionLanguage = ?, transcribedAt = ?, status = ?, errorMessage = ? WHERE id = ?`
      )
      .run(
        data.title ?? existing.title,
        data.duration ?? existing.duration,
        data.transcript ?? existing.transcript,
        data.transcriptionLanguage ?? existing.transcriptionLanguage,
        data.transcribedAt ?? existing.transcribedAt,
        data.status ?? existing.status,
        data.errorMessage ?? existing.errorMessage,
        id
      )
    return this.getById(id)
  }

  delete(id: string): boolean {
    const result = this.db
      .prepare('DELETE FROM recordings WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}
