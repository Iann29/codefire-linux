// ─── Project Discovery ──────────────────────────────────────────────────────
//
// Discovers Claude Code projects by scanning ~/.claude/projects/ and resolving
// the encoded directory names back to real filesystem paths.
//
// Encoded names replace `/`, `-`, ` `, and `.` with `-`, making them ambiguous.
// We use recursive backtracking with filesystem validation to resolve them.
//

import * as fs from 'fs'
import * as path from 'path'
import { homedir } from 'os'
import Database from 'better-sqlite3'
import { ProjectDAO } from '../database/dao/ProjectDAO'
import { parseSessionFile } from './SessionParser'
import { SessionDAO } from '../database/dao/SessionDAO'

export interface DiscoveredProject {
  encodedName: string
  resolvedPath: string | null
  name: string
  sessionFiles: string[]
}

/**
 * Resolve an encoded Claude project directory name back to its real filesystem path.
 *
 * The encoding replaces `/`, `-`, ` `, and `.` all with `-`.
 * This is ambiguous, so we try all possible interpretations using backtracking
 * and validate against the actual filesystem.
 *
 * @param encoded - The encoded directory name (e.g., `-Users-nicknorris-Documents-my-project`)
 * @param timeoutMs - Maximum time to spend on resolution (default 500ms)
 * @returns The resolved absolute path, or null if resolution fails
 */
export function resolvePath(encoded: string, timeoutMs = 500): string | null {
  // Encoded names start with `-` representing the leading `/`
  if (!encoded.startsWith('-')) return null
  const rootDir = '/'
  const chars = encoded.slice(1)

  if (chars.length === 0) return null

  const deadline = Date.now() + timeoutMs
  const failed = new Set<string>()

  function backtrack(charIndex: number, parentDir: string, current: string): string | null {
    // Check timeout
    if (Date.now() > deadline) return null

    // If we've consumed all characters, check if the full path exists
    if (charIndex === chars.length) {
      const fullPath = path.join(parentDir, current)
      try {
        fs.statSync(fullPath)
        return fullPath
      } catch {
        return null
      }
    }

    const ch = chars[charIndex]

    if (ch !== '-') {
      // Non-dash character: append to current component
      return backtrack(charIndex + 1, parentDir, current + ch)
    }

    // Dash character: try multiple interpretations
    const memoKey = `${charIndex}:${parentDir}:${current}`
    if (failed.has(memoKey)) return null

    // 1. Try as path separator — current component must exist as a directory
    if (current.length > 0) {
      const dirPath = path.join(parentDir, current)
      try {
        const stat = fs.statSync(dirPath)
        if (stat.isDirectory()) {
          const result = backtrack(charIndex + 1, dirPath, '')
          if (result) return result
        }
      } catch {
        // Directory doesn't exist, skip this interpretation
      }
    }

    // 2. Try as literal `-`
    const r1 = backtrack(charIndex + 1, parentDir, current + '-')
    if (r1) return r1

    // 3. Try as literal ` `
    const r2 = backtrack(charIndex + 1, parentDir, current + ' ')
    if (r2) return r2

    // 4. Try as literal `.`
    const r3 = backtrack(charIndex + 1, parentDir, current + '.')
    if (r3) return r3

    failed.add(memoKey)
    return null
  }

  return backtrack(0, rootDir, '')
}

/**
 * Discover all Claude Code projects from ~/.claude/projects/.
 *
 * Lists encoded project directories, attempts to resolve each to a real
 * filesystem path, and collects session file information.
 */
export function discoverProjects(): DiscoveredProject[] {
  const claudeProjectsDir = path.join(homedir(), '.claude', 'projects')

  let entries: string[]
  try {
    entries = fs.readdirSync(claudeProjectsDir)
  } catch {
    return []
  }

  const projects: DiscoveredProject[] = []

  for (const entry of entries) {
    // Skip the bare `-` directory (represents root `/`)
    if (entry === '-') continue

    const entryPath = path.join(claudeProjectsDir, entry)

    // Only process directories
    try {
      if (!fs.statSync(entryPath).isDirectory()) continue
    } catch {
      continue
    }

    // Attempt to resolve the encoded name to a real path
    const resolvedPath = resolvePath(entry)

    // Derive a human-readable name
    const name = resolvedPath
      ? path.basename(resolvedPath)
      : entry.split('-').filter(Boolean).pop() || entry

    // Collect .jsonl session files
    let sessionFiles: string[] = []
    try {
      sessionFiles = fs
        .readdirSync(entryPath)
        .filter((f) => f.endsWith('.jsonl') && isUUID(f.replace('.jsonl', '')))
    } catch {
      // If we can't read the directory, just report 0 sessions
    }

    projects.push({
      encodedName: entry,
      resolvedPath,
      name,
      sessionFiles,
    })
  }

  return projects
}

/**
 * Sync discovered projects with the database.
 *
 * - Creates new projects for newly discovered Claude directories
 * - Updates claudeProject path for existing projects matched by filesystem path
 * - Does NOT delete projects that are no longer on disk
 */
export function syncProjectsWithDatabase(
  db: Database.Database,
  discovered: DiscoveredProject[]
): void {
  const projectDAO = new ProjectDAO(db)
  const existingProjects = projectDAO.list()

  for (const disc of discovered) {
    if (!disc.resolvedPath) continue

    // Check if a project with this filesystem path already exists
    const existing = existingProjects.find((p) => p.path === disc.resolvedPath)

    if (existing) {
      // Update claudeProject if not already set
      if (!existing.claudeProject || existing.claudeProject !== disc.encodedName) {
        projectDAO.update(existing.id, { claudeProject: disc.encodedName })
      }
    } else {
      // Create new project
      projectDAO.create({
        name: disc.name,
        path: disc.resolvedPath,
        claudeProject: disc.encodedName,
      })
    }
  }
}

/**
 * Import all sessions for a specific project from its Claude directory.
 *
 * Reads each .jsonl file, parses it with SessionParser, and upserts
 * the session into the database.
 *
 * Skips re-parsing if session already exists AND has token data.
 */
export function importProjectSessions(
  db: Database.Database,
  projectId: string,
  encodedName: string
): number {
  const claudeDir = path.join(homedir(), '.claude', 'projects', encodedName)
  const sessionDAO = new SessionDAO(db)

  let files: string[]
  try {
    files = fs
      .readdirSync(claudeDir)
      .filter((f) => f.endsWith('.jsonl') && isUUID(f.replace('.jsonl', '')))
  } catch {
    return 0
  }

  let imported = 0

  for (const file of files) {
    const sessionId = file.replace('.jsonl', '')

    // Skip if session already exists with token data
    const existing = sessionDAO.getById(sessionId)
    if (existing && (existing.inputTokens > 0 || existing.outputTokens > 0)) {
      continue
    }

    let content: string
    try {
      content = fs.readFileSync(path.join(claudeDir, file), 'utf-8')
    } catch {
      continue
    }

    const parsed = parseSessionFile(content, sessionId)

    if (existing) {
      // Update existing session
      sessionDAO.update(sessionId, {
        endedAt: parsed.endedAt ?? undefined,
        messageCount: parsed.messageCount,
        toolUseCount: parsed.toolUseCount,
        filesChanged: parsed.filesChanged.length > 0 ? JSON.stringify(parsed.filesChanged) : undefined,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        cacheCreationTokens: parsed.cacheCreationTokens,
        cacheReadTokens: parsed.cacheReadTokens,
      })
    } else {
      // Create new session
      sessionDAO.create({
        id: sessionId,
        projectId,
        slug: parsed.slug ?? undefined,
        startedAt: parsed.startedAt ?? undefined,
        model: parsed.model ?? undefined,
        gitBranch: parsed.gitBranch ?? undefined,
      })
      // Then update with the rest of the parsed data
      sessionDAO.update(sessionId, {
        endedAt: parsed.endedAt ?? undefined,
        messageCount: parsed.messageCount,
        toolUseCount: parsed.toolUseCount,
        filesChanged: parsed.filesChanged.length > 0 ? JSON.stringify(parsed.filesChanged) : undefined,
        inputTokens: parsed.inputTokens,
        outputTokens: parsed.outputTokens,
        cacheCreationTokens: parsed.cacheCreationTokens,
        cacheReadTokens: parsed.cacheReadTokens,
      })
    }

    imported++
  }

  return imported
}

/**
 * Check if a string is a valid UUID v4 format.
 */
function isUUID(str: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)
}
