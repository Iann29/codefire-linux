import { ipcMain } from 'electron'
import { RouteDiscoveryService } from '../services/routes/RouteDiscoveryService'

export function registerRouteHandlers() {
  const service = new RouteDiscoveryService()

  ipcMain.handle('routes:discover', (_event, projectPath: string) => {
    if (!projectPath || typeof projectPath !== 'string') {
      throw new Error('projectPath is required and must be a string')
    }
    return service.analyzeProject(projectPath)
  })
}
