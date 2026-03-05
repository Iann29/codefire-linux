import { ipcMain } from 'electron'
import { readConfig, writeConfig } from '../services/ConfigStore'
import { GoogleOAuth } from '../services/GoogleOAuth'
import { GmailService } from '../services/GmailService'
import { registerGmailHandlers } from './gmail-handlers'
import type Database from 'better-sqlite3'
import type { AppConfig } from '@shared/models'

export function registerSettingsHandlers(
  db: Database.Database,
  onGmailReady?: (service: GmailService) => void
) {
  ipcMain.handle('settings:get', () => {
    return readConfig()
  })

  ipcMain.handle('settings:set', (_event, settings: Partial<AppConfig>) => {
    writeConfig(settings)

    // If Google credentials were provided, reinitialize Gmail service
    const config = readConfig()
    if (config.googleClientId && config.googleClientSecret) {
      const oauth = new GoogleOAuth(config.googleClientId, config.googleClientSecret)
      const gmailService = new GmailService(db, oauth)
      registerGmailHandlers(gmailService)
      onGmailReady?.(gmailService)
    }

    return { success: true }
  })
}
