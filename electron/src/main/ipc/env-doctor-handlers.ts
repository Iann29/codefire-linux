import { ipcMain } from 'electron'
import { EnvDoctorService } from '../services/EnvDoctorService'

export function registerEnvDoctorHandlers() {
  const service = new EnvDoctorService()

  ipcMain.handle('env-doctor:analyze', async (_event, projectPath: string) => {
    if (!projectPath || typeof projectPath !== 'string') {
      throw new Error('projectPath is required and must be a string')
    }
    return service.analyzeProject(projectPath)
  })
}
