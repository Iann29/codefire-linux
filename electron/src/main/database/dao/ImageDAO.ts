import Database from 'better-sqlite3'
import type { GeneratedImage } from '@shared/models'

export class ImageDAO {
  constructor(private db: Database.Database) {}

  list(projectId: string): GeneratedImage[] {
    return this.db
      .prepare('SELECT * FROM generatedImages WHERE projectId = ? ORDER BY createdAt DESC')
      .all(projectId) as GeneratedImage[]
  }

  getById(id: number): GeneratedImage | undefined {
    return this.db
      .prepare('SELECT * FROM generatedImages WHERE id = ?')
      .get(id) as GeneratedImage | undefined
  }

  create(data: {
    projectId: string
    prompt: string
    filePath: string
    model: string
    responseText?: string
    aspectRatio?: string
    imageSize?: string
    parentImageId?: number
  }): GeneratedImage {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO generatedImages (projectId, prompt, responseText, filePath, model, aspectRatio, imageSize, parentImageId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.projectId,
        data.prompt,
        data.responseText ?? null,
        data.filePath,
        data.model,
        data.aspectRatio ?? '1:1',
        data.imageSize ?? '1K',
        data.parentImageId ?? null,
        now
      )
    return this.getById(Number(result.lastInsertRowid))!
  }

  delete(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM generatedImages WHERE id = ?')
      .run(id)
    return result.changes > 0
  }
}
