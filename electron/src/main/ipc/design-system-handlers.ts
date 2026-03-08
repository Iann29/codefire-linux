import { ipcMain } from 'electron'
import { DesignSystemService } from '../services/design-system/DesignSystemService'

export function registerDesignSystemHandlers() {
  const service = new DesignSystemService()

  ipcMain.handle('design-system:analyze', (_e, projectPath: string) => {
    return service.analyzeProject(projectPath)
  })
}
