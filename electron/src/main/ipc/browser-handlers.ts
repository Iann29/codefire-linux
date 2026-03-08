import { ipcMain, session } from 'electron'

const BROWSER_PARTITION = 'persist:browser'

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
}
