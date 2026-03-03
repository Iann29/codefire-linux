import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import {
  discoverProjects,
  syncProjectsWithDatabase,
  importProjectSessions,
} from '../services/ProjectDiscovery'
import { ProjectDAO } from '../database/dao/ProjectDAO'

export function registerDiscoveryHandlers(db: Database.Database) {
  const projectDAO = new ProjectDAO(db)

  ipcMain.handle('discovery:scanProjects', () => {
    const discovered = discoverProjects()
    syncProjectsWithDatabase(db, discovered)
    return discovered
  })

  ipcMain.handle('discovery:importSessions', (_e, projectId: string) => {
    const project = projectDAO.getById(projectId)
    if (!project?.claudeProject) {
      return { imported: 0, error: 'Project not found or no Claude project linked' }
    }

    const imported = importProjectSessions(db, projectId, project.claudeProject)
    return { imported }
  })
}
