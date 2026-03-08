import { ipcMain } from 'electron'
import { ComponentGraphService } from '../services/component-graph/ComponentGraphService'

export function registerComponentGraphHandlers() {
  const service = new ComponentGraphService()

  ipcMain.handle('component-graph:analyze', (_e, projectPath: string) => {
    return service.analyzeProject(projectPath)
  })
}
