import Database from 'better-sqlite3'
import { ipcMain } from 'electron'
import { registerProjectHandlers } from './project-handlers'
import { registerTaskHandlers } from './task-handlers'
import { registerNoteHandlers } from './note-handlers'
import { registerSessionHandlers } from './session-handlers'
import { registerClientHandlers } from './client-handlers'
import { registerWindowHandlers } from './window-handlers'
import { registerTerminalHandlers } from './terminal-handlers'
import { registerDiscoveryHandlers } from './discovery-handlers'
import { discoverProjects, syncProjectsWithDatabase } from '../services/ProjectDiscovery'
import { registerGitHandlers } from './git-handlers'
import { registerSearchHandlers } from './search-handlers'
import { registerGitHubHandlers } from './github-handlers'
import { registerGmailHandlers } from './gmail-handlers'
import { registerFileHandlers } from './file-handlers'
import { registerMemoryHandlers } from './memory-handlers'
import { registerRulesHandlers } from './rules-handlers'
import { registerServiceHandlers } from './service-handlers'
import { registerImageHandlers } from './image-handlers'
import { registerRecordingHandlers } from './recording-handlers'
import { registerSettingsHandlers } from './settings-handlers'
import { registerBriefingHandlers } from './briefing-handlers'
import { registerChatHandlers } from './chat-handlers'
import { registerUpdateHandlers } from './update-handlers'
import { registerBrowserHandlers } from './browser-handlers'
import { registerEnvDoctorHandlers } from './env-doctor-handlers'
import { registerRouteHandlers } from './route-handlers'
import { registerPreviewHandlers } from './preview-handlers'
import { registerVisualBaselineHandlers } from './visual-baseline-handlers'
import { registerDesignSystemHandlers } from './design-system-handlers'
import { registerComponentGraphHandlers } from './component-graph-handlers'
import { registerLaunchGuardHandlers } from './launch-guard-handlers'
import { registerContentStudioHandlers } from './content-studio-handlers'
import { registerPromptHandlers } from './prompt-handlers'
import type { WindowManager } from '../windows/WindowManager'
import type { TerminalService } from '../services/TerminalService'
import type { GitService } from '../services/GitService'
import type { GitHubService } from '../services/GitHubService'
import type { GmailService } from '../services/GmailService'
import type { SearchEngine } from '../services/SearchEngine'
import type { ContextEngine } from '../services/ContextEngine'
import type { FileWatcher } from '../services/FileWatcher'

export function registerAllHandlers(
  db: Database.Database,
  windowManager?: WindowManager,
  terminalService?: TerminalService,
  gitService?: GitService,
  githubService?: GitHubService,
  gmailService?: GmailService,
  searchEngine?: SearchEngine,
  contextEngine?: ContextEngine,
  fileWatcher?: FileWatcher
) {
  registerProjectHandlers(db)
  registerTaskHandlers(db)
  registerNoteHandlers(db)
  registerSessionHandlers(db)
  registerClientHandlers(db)
  registerDiscoveryHandlers(db)
  if (windowManager) {
    registerWindowHandlers(windowManager, db, fileWatcher)
  }
  if (terminalService) {
    registerTerminalHandlers(terminalService)
  } else {
    // Register availability check even when terminal is unavailable
    ipcMain.handle('terminal:available', () => false)
  }
  if (gitService) {
    registerGitHandlers(gitService)
  }
  if (githubService) {
    registerGitHubHandlers(githubService)
  }
  if (gmailService) {
    registerGmailHandlers(gmailService)
  }
  if (searchEngine && contextEngine) {
    registerSearchHandlers(db, searchEngine, contextEngine)
  }
  registerFileHandlers()
  registerMemoryHandlers(db)
  registerRulesHandlers(db)
  registerServiceHandlers()
  registerImageHandlers(db)
  registerRecordingHandlers(db)
  registerSettingsHandlers(db)
  registerChatHandlers(db)
  registerBriefingHandlers(db)
  registerUpdateHandlers()
  registerBrowserHandlers()
  registerEnvDoctorHandlers()
  registerRouteHandlers()
  registerPreviewHandlers()
  registerVisualBaselineHandlers(db)
  registerDesignSystemHandlers()
  registerComponentGraphHandlers()
  registerLaunchGuardHandlers()
  registerContentStudioHandlers()
  registerPromptHandlers(db)

  // Run project discovery at startup to populate claudeProject links (deferred to not block startup)
  setImmediate(() => {
    try {
      const discovered = discoverProjects()
      syncProjectsWithDatabase(db, discovered)
    } catch {
      // Non-fatal — discovery will still work via IPC
    }
  })
}
