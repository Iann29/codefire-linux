import { ipcMain } from 'electron'
import Database from 'better-sqlite3'
import { ImageDAO } from '../database/dao/ImageDAO'

export function registerImageHandlers(db: Database.Database) {
  const imageDAO = new ImageDAO(db)

  ipcMain.handle('images:list', (_e, projectId: string) =>
    imageDAO.list(projectId)
  )

  ipcMain.handle('images:get', (_e, id: number) =>
    imageDAO.getById(id)
  )

  ipcMain.handle(
    'images:create',
    (
      _e,
      data: {
        projectId: string
        prompt: string
        filePath: string
        model: string
        responseText?: string
        aspectRatio?: string
        imageSize?: string
        parentImageId?: number
      }
    ) => imageDAO.create(data)
  )

  ipcMain.handle('images:delete', (_e, id: number) =>
    imageDAO.delete(id)
  )
}
