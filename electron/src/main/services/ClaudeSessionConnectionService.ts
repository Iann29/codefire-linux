import Database from 'better-sqlite3'
import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'

interface ConnectedSession {
  sessionId: string
  projectId: string
  filePath: string
  isActive: boolean
  lastActivity: Date
}

export class ClaudeSessionConnectionService {
  constructor(private db: Database.Database) {}

  /**
   * Find the most likely active session for a project.
   * Uses mtime heuristic with configurable threshold.
   */
  findActiveSession(claudeProjectDir: string, thresholdMinutes = 5): ConnectedSession | null {
    if (!claudeProjectDir || !fs.existsSync(claudeProjectDir)) return null

    try {
      const files = fs.readdirSync(claudeProjectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const filePath = path.join(claudeProjectDir, f)
          const stat = fs.statSync(filePath)
          return {
            sessionId: f.replace('.jsonl', ''),
            filePath,
            mtime: stat.mtimeMs,
          }
        })
        .sort((a, b) => b.mtime - a.mtime)

      if (files.length === 0) return null

      const latest = files[0]
      const ageMinutes = (Date.now() - latest.mtime) / 60000
      const isActive = ageMinutes <= thresholdMinutes

      return {
        sessionId: latest.sessionId,
        projectId: '', // caller fills this
        filePath: latest.filePath,
        isActive,
        lastActivity: new Date(latest.mtime),
      }
    } catch {
      return null
    }
  }

  /**
   * Get the claude project directory for a given project.
   */
  getClaudeProjectDir(projectPath: string): string | null {
    // Try direct claudeProject field from DB first
    const row = this.db.prepare(
      'SELECT claudeProject FROM projects WHERE path = ?'
    ).get(projectPath) as { claudeProject?: string } | undefined

    if (row?.claudeProject) {
      const dir = path.join(homedir(), '.claude', 'projects', row.claudeProject)
      if (fs.existsSync(dir)) return dir
    }

    return null
  }

  /**
   * List all recent sessions for a project, sorted by recency.
   */
  listRecentSessions(claudeProjectDir: string, limit = 10): ConnectedSession[] {
    if (!claudeProjectDir || !fs.existsSync(claudeProjectDir)) return []

    try {
      return fs.readdirSync(claudeProjectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const filePath = path.join(claudeProjectDir, f)
          const stat = fs.statSync(filePath)
          const ageMinutes = (Date.now() - stat.mtimeMs) / 60000
          return {
            sessionId: f.replace('.jsonl', ''),
            projectId: '',
            filePath,
            isActive: ageMinutes <= 5,
            lastActivity: new Date(stat.mtimeMs),
          }
        })
        .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime())
        .slice(0, limit)
    } catch {
      return []
    }
  }

  /**
   * Build the resume command for a session.
   */
  buildResumeCommand(sessionId: string, cli = 'claude'): string {
    return `${cli} --resume ${sessionId}`
  }
}
