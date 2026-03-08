import Database from 'better-sqlite3'
import type { VisualBaseline, VisualComparison } from '@shared/models'

export class VisualBaselineDAO {
  constructor(private db: Database.Database) {}

  listBaselines(projectId: string, routeKey?: string): VisualBaseline[] {
    if (routeKey) {
      return this.db
        .prepare('SELECT * FROM visualBaselines WHERE projectId = ? AND routeKey = ? ORDER BY createdAt DESC')
        .all(projectId, routeKey) as VisualBaseline[]
    }
    return this.db
      .prepare('SELECT * FROM visualBaselines WHERE projectId = ? ORDER BY createdAt DESC')
      .all(projectId) as VisualBaseline[]
  }

  getBaseline(id: number): VisualBaseline | undefined {
    return this.db
      .prepare('SELECT * FROM visualBaselines WHERE id = ?')
      .get(id) as VisualBaseline | undefined
  }

  createBaseline(data: {
    projectId: string
    routeKey: string
    pageUrl: string
    viewportWidth: number
    viewportHeight: number
    label?: string
    imagePath: string
  }): VisualBaseline {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO visualBaselines (projectId, routeKey, pageUrl, viewportWidth, viewportHeight, label, imagePath, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.projectId,
        data.routeKey,
        data.pageUrl,
        data.viewportWidth,
        data.viewportHeight,
        data.label ?? null,
        data.imagePath,
        now
      )
    return this.getBaseline(Number(result.lastInsertRowid))!
  }

  deleteBaseline(id: number): boolean {
    const result = this.db
      .prepare('DELETE FROM visualBaselines WHERE id = ?')
      .run(id)
    return result.changes > 0
  }

  createComparison(data: {
    projectId: string
    baselineId: number
    currentImagePath: string
    diffImagePath?: string
    diffPercent: number
    status: string
  }): VisualComparison {
    const now = new Date().toISOString()
    const result = this.db
      .prepare(
        `INSERT INTO visualComparisons (projectId, baselineId, currentImagePath, diffImagePath, diffPercent, status, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        data.projectId,
        data.baselineId,
        data.currentImagePath,
        data.diffImagePath ?? null,
        data.diffPercent,
        data.status,
        now
      )
    return this.db
      .prepare('SELECT * FROM visualComparisons WHERE id = ?')
      .get(Number(result.lastInsertRowid)) as VisualComparison
  }

  listComparisons(baselineId: number): VisualComparison[] {
    return this.db
      .prepare('SELECT * FROM visualComparisons WHERE baselineId = ? ORDER BY createdAt DESC')
      .all(baselineId) as VisualComparison[]
  }

  getLatestComparison(baselineId: number): VisualComparison | undefined {
    return this.db
      .prepare('SELECT * FROM visualComparisons WHERE baselineId = ? ORDER BY createdAt DESC LIMIT 1')
      .get(baselineId) as VisualComparison | undefined
  }

  updateComparisonStatus(id: number, status: string): boolean {
    const result = this.db
      .prepare('UPDATE visualComparisons SET status = ? WHERE id = ?')
      .run(status, id)
    return result.changes > 0
  }
}
