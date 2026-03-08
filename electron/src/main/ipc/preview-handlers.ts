import { ipcMain } from 'electron'
import { PreviewDiscoveryService } from '../services/PreviewDiscoveryService'

export function registerPreviewHandlers() {
  const service = new PreviewDiscoveryService()

  ipcMain.handle(
    'preview:discover',
    async (
      _event,
      projectPath: string,
      gitInfo?: { branch: string; isClean: boolean },
      githubInfo?: {
        owner: string
        repo: string
        prs: Array<{
          number: number
          title: string
          head_branch: string
          state: string
        }>
      }
    ) => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required and must be a string')
      }
      return service.discoverEnvironments(projectPath, gitInfo, githubInfo)
    }
  )
}
