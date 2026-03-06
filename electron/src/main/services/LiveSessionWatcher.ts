import fs from 'fs'
import path from 'path'
import os from 'os'
import { BrowserWindow } from 'electron'
import { parseLiveSession } from './SessionParser'

export class LiveSessionWatcher {
  private timer: ReturnType<typeof setInterval> | null = null
  private sessionFile: string | null = null
  private lastReadOffset = 0
  private accumulatedContent = ''

  /**
   * Find the most recent active Claude Code session JSONL file.
   */
  findActiveSession(): string | null {
    const claudeDir = path.join(os.homedir(), '.claude', 'projects')
    if (!fs.existsSync(claudeDir)) return null

    let newest: { path: string; mtime: number } | null = null

    const walk = (dir: string) => {
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name)
          if (entry.isDirectory()) {
            walk(full)
          } else if (entry.name.endsWith('.jsonl')) {
            const stat = fs.statSync(full)
            // Only consider files modified in the last 5 minutes
            if (Date.now() - stat.mtimeMs < 300_000) {
              if (!newest || stat.mtimeMs > newest.mtime) {
                newest = { path: full, mtime: stat.mtimeMs }
              }
            }
          }
        }
      } catch {
        // Permission errors, etc.
      }
    }

    walk(claudeDir)
    return newest?.path ?? null
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.poll(), 2000)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.sessionFile = null
    this.lastReadOffset = 0
    this.accumulatedContent = ''
  }

  private poll(): void {
    // Re-detect active session periodically
    const active = this.findActiveSession()
    if (active !== this.sessionFile) {
      this.sessionFile = active
      this.lastReadOffset = 0
      this.accumulatedContent = ''
    }

    if (!this.sessionFile || !fs.existsSync(this.sessionFile)) return

    try {
      const stat = fs.statSync(this.sessionFile)
      if (stat.size <= this.lastReadOffset) return // No new data

      // Read only new bytes
      const fd = fs.openSync(this.sessionFile, 'r')
      const newBytes = Buffer.alloc(stat.size - this.lastReadOffset)
      fs.readSync(fd, newBytes, 0, newBytes.length, this.lastReadOffset)
      fs.closeSync(fd)

      this.lastReadOffset = stat.size
      this.accumulatedContent += newBytes.toString('utf-8')

      // Parse accumulated content
      const sessionId = path.basename(this.sessionFile, '.jsonl')
      const state = parseLiveSession(this.accumulatedContent, sessionId)

      // Broadcast to all windows
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('sessions:liveUpdate', state)
      }
    } catch {
      // File may be temporarily locked
    }
  }
}
