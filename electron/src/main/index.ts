import { app, BrowserWindow, globalShortcut, ipcMain, Menu } from 'electron'
import path from 'path'
import { getDatabase, closeDatabase } from './database/connection'
import { registerAllHandlers } from './ipc'
import { registerSearchHandlers } from './ipc/search-handlers'
import { registerGmailHandlers } from './ipc/gmail-handlers'
import { WindowManager } from './windows/WindowManager'
import { TrayManager } from './windows/TrayManager'
import { TerminalService } from './services/TerminalService'
import { GitService } from './services/GitService'
import { GoogleOAuth } from './services/GoogleOAuth'
import { GmailService } from './services/GmailService'
import { readConfig } from './services/ConfigStore'
import { MCPServerManager } from './services/MCPServerManager'
import { DeepLinkService } from './services/DeepLinkService'
import { SearchEngine } from './services/SearchEngine'
import { ContextEngine } from './services/ContextEngine'
import { EmbeddingClient } from './services/EmbeddingClient'
import { BrowserCommandExecutor } from './services/BrowserCommandExecutor'
import { BrowserBridge } from './services/BrowserBridge'
import { AgentService } from './services/AgentService'
import { LiveSessionWatcher } from './services/LiveSessionWatcher'
import { FileWatcher } from './services/FileWatcher'
import { ProjectDAO } from './database/dao/ProjectDAO'
import { registerAgentHandlers, providerRouter } from './ipc/agent-handlers'

// Prevent crashes from uncaught errors
process.on('uncaughtException', (err) => {
  console.error('[MAIN] Uncaught exception:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[MAIN] Unhandled rejection:', reason)
})

process.env.DIST_ELECTRON = path.join(__dirname, '..')
process.env.DIST = path.join(process.env.DIST_ELECTRON, '../dist')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? path.join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

// Initialize database, window manager, terminal service, and git service
const db = getDatabase()
const windowManager = WindowManager.getInstance()
const trayManager = new TrayManager(windowManager)
// TerminalService handles node-pty availability internally via lazy require
const terminalService = new TerminalService()
const gitService = new GitService()

// Read config early (lightweight)
const config = readConfig()

// Initialize MCP server manager (polls for active MCP connections)
const mcpManager = new MCPServerManager()

// Deferred services — initialized after window shows for faster startup
let gmailService: GmailService | undefined
let searchEngine: SearchEngine
let contextEngine: ContextEngine
let fileWatcher: FileWatcher
let browserExecutor: BrowserCommandExecutor | null = null
let liveWatcher: LiveSessionWatcher
let agentService: AgentService | null = null

function initDeferredServices() {
  // Gmail
  const googleClientId = config.googleClientId || process.env.GOOGLE_CLIENT_ID
  const googleClientSecret = config.googleClientSecret || process.env.GOOGLE_CLIENT_SECRET
  if (googleClientId && googleClientSecret) {
    const oauth = new GoogleOAuth(googleClientId, googleClientSecret)
    gmailService = new GmailService(db, oauth)
  }

  // Search and context engines
  const embeddingClient = new EmbeddingClient(config.openRouterKey || undefined)
  searchEngine = new SearchEngine(db, embeddingClient)
  contextEngine = new ContextEngine(db)

  // File watcher for incremental index updates
  fileWatcher = new FileWatcher()
  const projectDAO = new ProjectDAO(db)

  fileWatcher.onFilesChanged = (projectId: string, changedPaths: string[]) => {
    const project = projectDAO.getById(projectId)
    if (!project) return

    console.log(`[FileWatcher] Re-indexing ${changedPaths.length} changed file(s) in project ${projectId}`)
    for (const absPath of changedPaths) {
      const relativePath = path.relative(project.path, absPath)
      contextEngine.indexFile(projectId, project.path, relativePath).catch((err) => {
        console.error(`[FileWatcher] Failed to re-index ${relativePath}:`, err)
      })
    }
  }

  // Browser command executor
  browserExecutor = new BrowserCommandExecutor(db)
  browserExecutor.start()

  // Main-process agent runtime (V2)
  const browserBridge = new BrowserBridge()
  agentService = new AgentService(db, gitService, browserBridge, searchEngine)
  registerAgentHandlers(agentService)

  // Wire shared ProviderRouter (with OAuthEngine) into AgentService
  agentService.setProviderRouter(providerRouter)

  // Live session watcher
  liveWatcher = new LiveSessionWatcher()
  liveWatcher.start()

  // Register deferred IPC handlers
  registerSearchHandlers(db, searchEngine, contextEngine)
  if (gmailService) {
    ipcMain.removeHandler('gmail:listRecentEmails')
    registerGmailHandlers(gmailService)
  }

  // Premium services (only if configured)
  if (config.premiumEnabled && config.supabaseUrl && config.supabaseAnonKey) {
    // Remove all stubs before registering real handlers
    for (const channel of Object.keys(premiumStubs)) {
      ipcMain.removeHandler(channel)
    }
    try {
      const { AuthService } = require('./services/premium/AuthService')
      const { TeamService } = require('./services/premium/TeamService')
      const { SyncEngine } = require('./services/premium/SyncEngine')
      const { PresenceService } = require('./services/premium/PresenceService')
      const { registerPremiumHandlers } = require('./ipc/premium-handlers')
      const authSvc = new AuthService()
      const teamSvc = new TeamService()
      const syncEng = new SyncEngine(db)
      const presenceSvc = new PresenceService()
      registerPremiumHandlers(authSvc, teamSvc, syncEng, presenceSvc)
      syncEng.start()
      console.log('[Main] Premium services initialized')
    } catch (err) {
      console.warn('[Main] Premium services unavailable:', err)
    }
  }
}

// Initialize deep link service and register codefire:// protocol
const deepLinkService = new DeepLinkService()

if (process.defaultApp) {
  // Dev mode: register with the path to electron + script
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('codefire', process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient('codefire')
}

/** Process a codefire:// URL and broadcast result to all renderer windows */
function handleDeepLinkURL(url: string) {
  const result = deepLinkService.handleURL(url)
  if (!result) return
  // Ensure the app window is visible and focused
  const mainWin = windowManager.getMainWindow()
  if (mainWin) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show()
    mainWin.focus()
  }
  // Broadcast result to all renderer windows
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('deeplink:result', result)
  }
}

// Second instance passes deep link URL via argv
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith('codefire://'))
    if (url) handleDeepLinkURL(url)
    // Focus existing window
    const mainWin = windowManager.getMainWindow()
    if (mainWin) {
      if (mainWin.isMinimized()) mainWin.restore()
      mainWin.show()
      mainWin.focus()
    }
  })
}

// Register essential IPC handlers immediately (db, window, terminal, git, MCP)
registerAllHandlers(db, windowManager, terminalService, gitService, undefined, undefined, undefined, undefined, mcpManager, undefined)

// Fallback stubs for premium and gmail — renderer calls these before deferred init.
// Replaced by real handlers in initDeferredServices() if the services are configured.
const premiumStub = () => null
const premiumStubs: Record<string, (...args: any[]) => any> = {
  'premium:getStatus': () => ({ authenticated: false, user: null, team: null, subscription: null }),
  'premium:signUp': premiumStub, 'premium:signIn': premiumStub, 'premium:signOut': premiumStub,
  'premium:createTeam': premiumStub, 'premium:getTeam': () => null,
  'premium:listMembers': () => [], 'premium:inviteMember': premiumStub,
  'premium:removeMember': premiumStub, 'premium:acceptInvite': premiumStub,
  'premium:syncProject': premiumStub, 'premium:unsyncProject': premiumStub,
  'premium:createCheckout': premiumStub, 'premium:getBillingPortal': premiumStub,
  'premium:getNotifications': () => [], 'premium:markNotificationRead': premiumStub,
  'premium:markAllNotificationsRead': premiumStub,
  'premium:getActivityFeed': () => [], 'premium:listSessionSummaries': () => [],
  'premium:shareSessionSummary': premiumStub,
  'premium:joinPresence': premiumStub, 'premium:leavePresence': premiumStub,
  'premium:getPresence': () => [],
  'premium:listProjectDocs': () => [], 'premium:getProjectDoc': () => null,
  'premium:createProjectDoc': premiumStub, 'premium:updateProjectDoc': premiumStub,
  'premium:deleteProjectDoc': premiumStub,
  'premium:requestReview': premiumStub, 'premium:resolveReview': premiumStub,
  'premium:listReviewRequests': () => [],
  'premium:admin:isSuperAdmin': () => false, 'premium:admin:searchUsers': () => [],
  'premium:admin:listGrants': () => [], 'premium:admin:grantTeam': premiumStub,
  'premium:admin:revokeGrant': premiumStub,
}
for (const [channel, handler] of Object.entries(premiumStubs)) {
  ipcMain.handle(channel, handler)
}
ipcMain.handle('gmail:listRecentEmails', () => [])

// Register Agent Arena handler
import { openAgentArena } from './windows/AgentArenaWindow'
ipcMain.handle('arena:open', () => {
  openAgentArena()
})

let isQuitting = false

// Start MCP connection polling and broadcast status to all renderer windows
if (config.mcpServerAutoStart) {
  mcpManager.setOnStatusChange((status, sessionCount) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('mcp:statusChanged', { status, sessionCount })
    }
  })
  mcpManager.start()
}

app.whenReady().then(() => {
  // Create system tray
  trayManager.create()

  // Build custom application menu
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Settings',
          accelerator: 'CommandOrControl+,',
          click: () => {
            const focused = BrowserWindow.getFocusedWindow()
            if (focused) focused.webContents.send('menu:openSettings')
          },
        },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    },
    { role: 'editMenu' as const },
    { role: 'viewMenu' as const },
    { role: 'windowMenu' as const },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))

  const mainWin = windowManager.createMainWindow()

  // Global shortcut: Ctrl+Shift+H to show/focus the planner window
  globalShortcut.register('CommandOrControl+Shift+H', () => {
    const win = windowManager.getMainWindow()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })

  // Defer heavy service init until after window is visible
  mainWin.once('ready-to-show', () => {
    setTimeout(() => initDeferredServices(), 100)
  })

  // Auto-recover from renderer crashes
  mainWin.webContents.on('render-process-gone', (_event, details) => {
    console.error('[MAIN] Renderer crashed:', details.reason, details.exitCode)
    if (details.reason !== 'clean-exit') {
      mainWin.webContents.reload()
    }
  })
  mainWin.webContents.on('unresponsive', () => {
    console.error('[MAIN] Renderer became unresponsive')
  })
  mainWin.webContents.on('responsive', () => {
    console.log('[MAIN] Renderer became responsive again')
  })

  // Handle deep link URL if the app was launched via protocol (cold start)
  const deepLinkArg = process.argv.find((arg) => arg.startsWith('codefire://'))
  if (deepLinkArg) {
    // Wait for the renderer to be ready before sending the result
    mainWin.webContents.once('did-finish-load', () => {
      handleDeepLinkURL(deepLinkArg)
    })
  }

  // Minimize to tray instead of closing
  mainWin.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWin.hide()
    }
  })
})

app.on('window-all-closed', () => {
  // No-op: app stays alive in tray
})

app.on('activate', () => {
  const mainWin = windowManager.getMainWindow()
  if (mainWin) {
    mainWin.show()
    mainWin.focus()
  }
})

app.on('before-quit', () => {
  isQuitting = true
  if (fileWatcher) fileWatcher.unwatchAll()
  if (liveWatcher) liveWatcher.stop()
  if (browserExecutor) browserExecutor.stop()
  trayManager.destroy()
  terminalService?.killAll()
  closeDatabase()
})
