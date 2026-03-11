import { ipcMain } from 'electron'
import { readConfig, writeConfig } from '../services/ConfigStore'
import { GoogleOAuth } from '../services/GoogleOAuth'
import { GmailService } from '../services/GmailService'
import { registerGmailHandlers } from './gmail-handlers'
import type Database from 'better-sqlite3'
import type { AppConfig } from '@shared/models'
import type { EmbeddingClient } from '../services/EmbeddingClient'

/** Keys that affect the embedding client configuration. */
const EMBEDDING_CONFIG_KEYS: (keyof AppConfig)[] = [
  'embeddingModel',
  'openRouterKey',
  'googleAiApiKey',
]

/**
 * Mutable reference to the embedding client.
 * Set via `setSettingsEmbeddingClient()` once deferred services are ready.
 * This avoids re-registering IPC handlers (which ipcMain.handle disallows).
 */
let embeddingClientRef: EmbeddingClient | null = null

/**
 * Late-bind the embedding client after deferred services are initialized.
 * Called from main/index.ts after creating the EmbeddingClient.
 */
export function setSettingsEmbeddingClient(client: EmbeddingClient): void {
  embeddingClientRef = client
}

export function registerSettingsHandlers(
  db: Database.Database,
  onGmailReady?: (service: GmailService) => void
) {
  ipcMain.handle('settings:get', () => {
    return readConfig()
  })

  ipcMain.handle('settings:set', (_event, settings: Partial<AppConfig>) => {
    writeConfig(settings)

    const config = readConfig()

    // If Google credentials were provided, reinitialize Gmail service
    if (config.googleClientId && config.googleClientSecret) {
      const oauth = new GoogleOAuth(config.googleClientId, config.googleClientSecret)
      const gmailService = new GmailService(db, oauth)
      registerGmailHandlers(gmailService)
      onGmailReady?.(gmailService)
    }

    // If embedding-related settings changed, update the client in real-time
    if (embeddingClientRef && EMBEDDING_CONFIG_KEYS.some((k) => k in settings)) {
      embeddingClientRef.updateConfig({
        model: config.embeddingModel,
        openRouterKey: config.openRouterKey || undefined,
        googleAiApiKey: config.googleAiApiKey || undefined,
      })
    }

    return { success: true }
  })
}
