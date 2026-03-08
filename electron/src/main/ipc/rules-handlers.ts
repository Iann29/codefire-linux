import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import Database from 'better-sqlite3'
import { ProjectDAO } from '../database/dao/ProjectDAO'
import { resolveClaudeProjectDir } from './memory-handlers'

export interface RuleFile {
  scope: 'global' | 'project' | 'local'
  label: string
  path: string
  exists: boolean
  color: 'blue' | 'purple' | 'orange'
}

const DEFAULT_TEMPLATE = `# CLAUDE.md

## Project Overview

## Code Style

## Important Patterns

## Testing

`

/**
 * Register IPC handlers for CLAUDE.md rule file operations.
 */
export function registerRulesHandlers(db: Database.Database) {
  const projectDAO = new ProjectDAO(db)

  ipcMain.handle(
    'rules:list',
    (_event, projectPath: string): RuleFile[] => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }

      const globalPath = path.join(os.homedir(), '.claude', 'CLAUDE.md')
      const projectFilePath = path.join(projectPath, 'CLAUDE.md')
      const localPath = path.join(projectPath, '.claude', 'CLAUDE.md')

      return [
        {
          scope: 'global',
          label: 'Global (~/.claude/CLAUDE.md)',
          path: globalPath,
          exists: fs.existsSync(globalPath),
          color: 'blue',
        },
        {
          scope: 'project',
          label: 'Project (CLAUDE.md)',
          path: projectFilePath,
          exists: fs.existsSync(projectFilePath),
          color: 'purple',
        },
        {
          scope: 'local',
          label: 'Local (.claude/CLAUDE.md)',
          path: localPath,
          exists: fs.existsSync(localPath),
          color: 'orange',
        },
      ]
    }
  )

  ipcMain.handle(
    'rules:read',
    (_event, filePath: string): string => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }

      try {
        return fs.readFileSync(filePath, 'utf-8')
      } catch (err) {
        throw new Error(
          `Failed to read rule file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'rules:write',
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
          `Failed to write rule file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  ipcMain.handle(
    'rules:create',
    (_event, filePath: string, template?: string): void => {
      if (!filePath || typeof filePath !== 'string') {
        throw new Error('filePath is required and must be a string')
      }

      try {
        const dir = path.dirname(filePath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }
        fs.writeFileSync(filePath, template ?? DEFAULT_TEMPLATE, 'utf-8')
      } catch (err) {
        throw new Error(
          `Failed to create rule file: ${err instanceof Error ? err.message : String(err)}`
        )
      }
    }
  )

  /**
   * Return the resolved Claude memory directory path for a project.
   * Uses the canonical `claudeProject` identifier when available,
   * falling back to path-encoding.
   */
  ipcMain.handle(
    'rules:getMemoryPath',
    (_event, projectPath: string, projectId?: string): string => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }

      let claudeProject: string | null = null

      if (projectId) {
        const project = projectDAO.getById(projectId)
        if (project?.claudeProject) {
          claudeProject = project.claudeProject
        }
      }

      if (!claudeProject) {
        const project = projectDAO.getByPath(projectPath)
        if (project?.claudeProject) {
          claudeProject = project.claudeProject
        }
      }

      const dirName = resolveClaudeProjectDir(projectPath, claudeProject)
      return path.join(os.homedir(), '.claude', 'projects', dirName, 'memory')
    }
  )
}
