import { randomUUID } from 'crypto'
import { BrowserWindow, ipcMain } from 'electron'

export interface BrowserBridgeCommand {
  tool: string
  args?: Record<string, unknown>
  projectId?: string | null
  timeoutMs?: number
}

export class BrowserBridge {
  async executeCommand(command: BrowserBridgeCommand): Promise<unknown> {
    const targetWindow = this.findTargetWindow(command.projectId)
    if (!targetWindow) {
      throw new Error('No browser window available to execute command')
    }

    // Signal the renderer to switch to the Browser view tab so the user
    // sees the browser and, critically, so the BrowserView component is
    // visible and can create/activate webviews as needed.
    targetWindow.webContents.send('browser:ensureVisible')

    const requestId = randomUUID()
    const resultChannel = `browser:result:${requestId}`
    const timeoutMs = Math.max(1_000, Math.min(command.timeoutMs ?? 30_000, 120_000))

    return new Promise((resolve, reject) => {
      const onResult = (_event: Electron.IpcMainEvent, result: unknown) => {
        clearTimeout(timeout)
        if (isErrorPayload(result)) {
          reject(new Error(result.error))
          return
        }
        resolve(result)
      }

      const timeout = setTimeout(() => {
        ipcMain.removeListener(resultChannel, onResult)
        reject(new Error(`Browser command "${command.tool}" timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      ipcMain.once(resultChannel, onResult)

      targetWindow.webContents.send('browser:execute', {
        requestId,
        tool: command.tool,
        args: command.args ?? {},
      })
    })
  }

  private findTargetWindow(projectId?: string | null): BrowserWindow | undefined {
    const windows = BrowserWindow.getAllWindows().filter((window) => !window.isDestroyed())
    if (windows.length === 0) return undefined

    if (projectId) {
      const projectWindow = windows.find((window) => {
        const url = window.webContents.getURL()
        return url.includes(`projectId=${encodeURIComponent(projectId)}`) || url.includes(`projectId=${projectId}`)
      })
      if (projectWindow) return projectWindow
    }

    const focusedWindow = BrowserWindow.getFocusedWindow()
    if (focusedWindow && !focusedWindow.isDestroyed()) return focusedWindow

    return windows[0]
  }
}

function isErrorPayload(value: unknown): value is { error: string } {
  return typeof value === 'object' && value !== null && 'error' in value && typeof (value as { error?: unknown }).error === 'string'
}
