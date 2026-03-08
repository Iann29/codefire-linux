import { ipcMain } from 'electron'
import { ContentStudioService } from '../services/content-studio/ContentStudioService'

const service = new ContentStudioService()

export function registerContentStudioHandlers(): void {
  ipcMain.handle('content-studio:generatePack', (_e, inputs: {
    type: string
    pageTitle: string
    pageUrl: string
    domSummary: string
    projectName: string
  }) => {
    return service.generatePack(inputs)
  })
}
