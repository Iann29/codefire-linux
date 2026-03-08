import { ipcMain } from 'electron'
import { LaunchGuardService } from '../services/launch-guard/LaunchGuardService'
import type { LaunchGuardInputs } from '../services/launch-guard/LaunchGuardService'

export function registerLaunchGuardHandlers() {
  const service = new LaunchGuardService()

  ipcMain.handle('launch-guard:run', async (_event, inputs: LaunchGuardInputs) => {
    if (!inputs || !inputs.projectPath || typeof inputs.projectPath !== 'string') {
      throw new Error('projectPath is required and must be a string')
    }
    return service.generateReport(inputs)
  })
}
