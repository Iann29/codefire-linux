import SwiftUI
import SwiftTerm
import AppKit

/// Tracks all active terminal views so they can be terminated on app quit.
final class TerminalTracker {
    static let shared = TerminalTracker()
    private var terminals: [ObjectIdentifier: WeakTerminalRef] = [:]

    private struct WeakTerminalRef {
        weak var view: LocalProcessTerminalView?
    }

    func register(_ view: LocalProcessTerminalView) {
        terminals[ObjectIdentifier(view)] = WeakTerminalRef(view: view)
    }

    func terminateAll() {
        for (_, ref) in terminals {
            if let process = ref.view?.process {
                // Send SIGHUP first (shells respond to this), then SIGKILL as fallback
                let pid = process.shellPid
                if pid > 0 {
                    kill(pid, SIGHUP)
                    kill(pid, SIGKILL)
                }
            }
        }
        terminals.removeAll()
    }
}

/// Handles app lifecycle — ensures shell processes are killed on quit.
class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        TerminalTracker.shared.terminateAll()
        return .terminateNow
    }

    func applicationWillTerminate(_ notification: Notification) {
        // Belt-and-suspenders: kill any remaining child processes
        TerminalTracker.shared.terminateAll()
    }

}

@main
struct CodeFireApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    @StateObject private var appState = AppState()
    @StateObject private var appSettings: AppSettings
    @StateObject private var sessionWatcher = SessionWatcher()
    @StateObject private var liveMonitor = LiveSessionMonitor()
    @StateObject private var devEnvironment = DevEnvironment()
    @StateObject private var projectAnalyzer = ProjectAnalyzer()
    @StateObject private var claudeService = ClaudeService()
    @StateObject private var githubService = GitHubService()
    @StateObject private var oauthManager: GoogleOAuthManager
    @StateObject private var gmailPoller: GmailPoller
    @StateObject private var contextEngine = ContextEngine()
    @StateObject private var briefingService = BriefingService()
    @StateObject private var notificationService: SystemNotificationService

    init() {
        // Register as a foreground GUI app. Without this, a bare SPM executable
        // isn't recognized by macOS as a real app — it won't become key/foreground,
        // so keyboard events go to whatever app was previously active.
        NSApplication.shared.setActivationPolicy(.regular)

        // Migrate data from old "Context" paths before any DB/service init
        Self.migrateFromContext()

        let oauth = GoogleOAuthManager()
        _oauthManager = StateObject(wrappedValue: oauth)
        let poller = GmailPoller(oauthManager: oauth)
        _gmailPoller = StateObject(wrappedValue: poller)

        let settings = AppSettings()
        _appSettings = StateObject(wrappedValue: settings)
        _notificationService = StateObject(wrappedValue: SystemNotificationService(
            settings: settings,
            gmailPoller: poller
        ))

        do {
            try DatabaseService.shared.setup()
        } catch {
            fatalError("Database setup failed: \(error)")
        }

        // Deploy MCP binary to ~/Library/Application Support/CodeFire/bin/
        // macOS blocks binaries inside .app bundles from being spawned as subprocesses,
        // so Claude Code needs the binary at a standalone path.
        Self.deployMCPBinary()
    }

    /// Copies the CodeFireMCP binary from the app bundle to Application Support
    /// so Claude Code can spawn it as an MCP server (binaries inside .app bundles hang).
    private static func deployMCPBinary() {
        guard let execURL = Bundle.main.executableURL else { return }
        let bundleMCP = execURL.deletingLastPathComponent().appendingPathComponent("CodeFireMCP")
        guard FileManager.default.fileExists(atPath: bundleMCP.path) else { return }

        let dest = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)
            .first!.appendingPathComponent("CodeFire/bin", isDirectory: true)
        let destBinary = dest.appendingPathComponent("CodeFireMCP")

        // Skip if already up-to-date (same size)
        if let srcAttr = try? FileManager.default.attributesOfItem(atPath: bundleMCP.path),
           let dstAttr = try? FileManager.default.attributesOfItem(atPath: destBinary.path),
           let srcSize = srcAttr[.size] as? Int,
           let dstSize = dstAttr[.size] as? Int,
           srcSize == dstSize {
            return
        }

        try? FileManager.default.createDirectory(at: dest, withIntermediateDirectories: true)
        try? FileManager.default.removeItem(at: destBinary)
        try? FileManager.default.copyItem(at: bundleMCP, to: destBinary)
        // Ensure executable
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: destBinary.path)
    }

    /// Migrates existing user data from old "Context" paths to new "CodeFire" paths.
    /// Moves the Application Support directory, renames database files, and copies UserDefaults.
    /// Only runs once: when the old directory exists and the new one does not.
    private static func migrateFromContext() {
        let fm = FileManager.default
        let appSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!

        let oldDir = appSupport.appendingPathComponent("Context", isDirectory: true)
        let newDir = appSupport.appendingPathComponent("CodeFire", isDirectory: true)

        // Only migrate if old exists AND new doesn't
        guard fm.fileExists(atPath: oldDir.path),
              !fm.fileExists(atPath: newDir.path) else { return }

        // 1. Move entire directory
        do {
            try fm.moveItem(at: oldDir, to: newDir)
        } catch {
            // If move fails, don't crash — just use fresh data
            return
        }

        // 2. Rename database files inside
        let dbRenames = [
            ("context.db", "codefire.db"),
            ("context.db-wal", "codefire.db-wal"),
            ("context.db-shm", "codefire.db-shm"),
        ]
        for (oldName, newName) in dbRenames {
            let oldFile = newDir.appendingPathComponent(oldName)
            let newFile = newDir.appendingPathComponent(newName)
            try? fm.moveItem(at: oldFile, to: newFile)
        }

        // 3. Migrate UserDefaults from old suite
        if let oldDefaults = UserDefaults(suiteName: "com.context.app") {
            let standardDefaults = UserDefaults.standard
            for (key, value) in oldDefaults.dictionaryRepresentation() {
                // Skip Apple's internal keys
                if key.hasPrefix("Apple") || key.hasPrefix("NS") || key.hasPrefix("com.apple") { continue }
                standardDefaults.set(value, forKey: key)
            }
            // Clean up old suite
            oldDefaults.removePersistentDomain(forName: "com.context.app")
        }
    }

    var body: some Scene {
        WindowGroup {
            MainSplitView()
                .environmentObject(appState)
                .environmentObject(appSettings)
                .environmentObject(liveMonitor)
                .environmentObject(devEnvironment)
                .environmentObject(projectAnalyzer)
                .environmentObject(claudeService)
                .environmentObject(gmailPoller)
                .environmentObject(githubService)
                .environmentObject(contextEngine)
                .environmentObject(briefingService)
                .onAppear {
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    appState.loadProjects()
                    if appSettings.gmailSyncEnabled {
                        gmailPoller.startPolling(interval: appSettings.gmailSyncInterval)
                    }
                    contextEngine.startPollingForRequests()
                    notificationService.observeGmailPoller()
                    notificationService.observeClaudeExitNotifications()
                    Task {
                        await briefingService.checkAndGenerate(settings: appSettings)
                    }
                }
                .onChange(of: appState.currentProject) { _, project in
                    if let project = project {
                        sessionWatcher.watchProject(project)
                        devEnvironment.scan(projectPath: project.path)
                        projectAnalyzer.scan(projectPath: project.path)
                        githubService.startMonitoring(projectPath: project.path)
                        contextEngine.startIndexing(projectId: project.id, projectPath: project.path)
                        if let claudeDir = project.claudeProject {
                            liveMonitor.startMonitoring(claudeProjectPath: claudeDir)
                        }
                    }
                }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1400, height: 900)

        WindowGroup(for: String.self) { $projectId in
            if let projectId {
                ProjectWindowView(projectId: projectId)
            }
        }
        .windowStyle(.hiddenTitleBar)
        .defaultSize(width: 1200, height: 850)

        Settings {
            SettingsView(settings: appSettings)
                .environmentObject(contextEngine)
        }
    }
}
