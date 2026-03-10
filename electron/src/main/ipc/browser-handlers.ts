import { ipcMain, session } from 'electron'
import { ContextualScreenshotService } from '../services/browser/ContextualScreenshotService'
import type { ResolvePageContextInput } from '@shared/models'

const BROWSER_PARTITION = 'persist:browser'

const contextualScreenshotService = new ContextualScreenshotService()

export function registerBrowserHandlers(): void {
  ipcMain.handle('browser:clearSession', async () => {
    const ses = session.fromPartition(BROWSER_PARTITION)

    await ses.clearStorageData({
      storages: [
        'cookies',
        'localstorage',
        'indexdb',
        'serviceworkers',
        'cachestorage',
      ],
    })

    await ses.clearCache()

    return { success: true, partition: BROWSER_PARTITION }
  })

  ipcMain.handle('browser:resolvePageContext', async (_event, input: ResolvePageContextInput) => {
    return contextualScreenshotService.resolvePageContext(input)
  })
}
