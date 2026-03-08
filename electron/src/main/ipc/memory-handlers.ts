import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Database from 'better-sqlite3'
import { ProjectDAO } from '../database/dao/ProjectDAO'

export interface MemoryEntry {
  name: string
  path: string
  isMain: boolean
}

/**
 * Encode a project path for use in the Claude memory directory structure.
 * Replaces '/' with '-' and prepends '-'.
 */
function encodeProjectPath(projectPath: string): string {
  return '-' + projectPath.replace(/\//g, '-')
}

/**
 * Resolve the Claude project directory identifier.
 * If `claudeProject` is available (from the database), use it directly.
 * Otherwise, fall back to the path-encoding logic.
 */
export function resolveClaudeProjectDir(
  projectPath: string,
  claudeProject?: string | null
): string {
  if (claudeProject) {
    return claudeProject
  }
  return encodeProjectPath(projectPath)
}

/**
 * Get the memory directory path for a given project, preferring the
 * canonical `claudeProject` identifier when available.
 */
function getMemoryDir(projectPath: string, claudeProject?: string | null): string {
  const dirName = resolveClaudeProjectDir(projectPath, claudeProject)
  return path.join(os.homedir(), '.claude', 'projects', dirName, 'memory')
}

/**
 * Look up a project's claudeProject field from the database.
 * Returns null if the project is not found or has no claudeProject set.
 */
function lookupClaudeProject(
  db: Database.Database,
  projectId?: string | null,
  projectPath?: string | null
): string | null {
  const projectDAO = new ProjectDAO(db)

  if (projectId) {
    const project = projectDAO.getById(projectId)
    if (project?.claudeProject) {
      return project.claudeProject
    }
  }

  if (projectPath) {
    const project = projectDAO.getByPath(projectPath)
    if (project?.claudeProject) {
      return project.claudeProject
    }
  }

  return null
}

/**
 * Register IPC handlers for memory file operations.
 */
export function registerMemoryHandlers(db: Database.Database) {
  ipcMain.handle(
    'memory:getDir',
    (_event, projectPath: string, projectId?: string): string => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }

      const claudeProject = lookupClaudeProject(db, projectId, projectPath)
      return getMemoryDir(projectPath, claudeProject)
    }
  )

  ipcMain.handle(
    'memory:list',
    (_event, projectPath: string, projectId?: string): MemoryEntry[] => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }

      const claudeProject = lookupClaudeProject(db, projectId, projectPath)
      const memDir = getMemoryDir(projectPath, claudeProject)

      try {
        if (!fs.existsSync(memDir)) {
          return []
        }

        const entries = fs.readdirSync(memDir, { withFileTypes: true })
        const result: MemoryEntry[] = []

        for (const entry of entries) {
          if (!entry.isFile() || !entry.name.endsWith('.md')) {
            continue
          }

          const fullPath = path.join(memDir, entry.name)
          result.push({
            name: entry.name,
            path: fullPath,
            isMain: entry.name === 'MEMORY.md',
          })
        }

        // Sort: MEMORY.md first, then alphabetical
        result.sort((a, b) => {
          if (a.isMain !== b.isMain) {
            return a.isMain ? -1 : 1
          }
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        })

        return result
      } catch (err) {
        throw new Error(
          `Failed to list memory files: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'memory:read',
    (_event, filePath: string): string => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }

      try {
        const stat = fs.statSync(filePath)
        if (stat.size > 2 * 1024 * 1024) {
          throw new Error('File too large (>2MB)')
        }
        return fs.readFileSync(filePath, 'utf-8')
      } catch (err) {
        throw new Error(
          `Failed to read memory file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'memory:write',
    (_event, filePath: string, content: string): void => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }
      if (typeof content !== 'string') {
        throw new Error('content must be a string')
      }

      try {
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(filePath, content, 'utf-8')
      } catch (err) {
        throw new Error(
          `Failed to write memory file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'memory:delete',
    (_event, filePath: string): void => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }

      try {
        fs.unlinkSync(filePath)
      } catch (err) {
        throw new Error(
          `Failed to delete memory file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'memory:create',
    (_event, projectPath: string, fileName: string, projectId?: string): MemoryEntry => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }
      if (!fileName || typeof fileName !== 'string') {
        throw new Error('fileName is required and must be a string')
      }

      // Ensure .md extension
      const name = fileName.endsWith('.md') ? fileName : `${fileName}.md`
      const claudeProject = lookupClaudeProject(db, projectId, projectPath)
      const memDir = getMemoryDir(projectPath, claudeProject)

      try {
        if (!fs.existsSync(memDir)) {
          fs.mkdirSync(memDir, { recursive: true })
        }

        const fullPath = path.join(memDir, name)
        if (fs.existsSync(fullPath)) {
          throw new Error(`Memory file already exists: ${name}`)
        }

        fs.writeFileSync(fullPath, '', 'utf-8')

        return {
          name,
          path: fullPath,
          isMain: name === 'MEMORY.md',
        }
      } catch (err) {
        throw new Error(
          `Failed to create memory file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )
}
