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
            ref.view?.process.terminate()
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
}

@main
struct ContextApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    @StateObject private var appState = AppState()
    @StateObject private var appSettings = AppSettings()
    @StateObject private var sessionWatcher = SessionWatcher()
    @StateObject private var liveMonitor = LiveSessionMonitor()
    @StateObject private var devEnvironment = DevEnvironment()
    @StateObject private var projectAnalyzer = ProjectAnalyzer()
    @StateObject private var claudeService = ClaudeService()

    init() {
        // Register as a foreground GUI app. Without this, a bare SPM executable
        // isn't recognized by macOS as a real app — it won't become key/foreground,
        // so keyboard events go to whatever app was previously active.
        NSApplication.shared.setActivationPolicy(.regular)

        do {
            try DatabaseService.shared.setup()
        } catch {
            fatalError("Database setup failed: \(error)")
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
                .onAppear {
                    NSApplication.shared.activate(ignoringOtherApps: true)
                    appState.loadProjects()
                }
                .onChange(of: appState.currentProject) { _, project in
                    if let project = project {
                        sessionWatcher.watchProject(project)
                        devEnvironment.scan(projectPath: project.path)
                        projectAnalyzer.scan(projectPath: project.path)
                        if let claudeDir = project.claudeProject {
                            liveMonitor.startMonitoring(claudeProjectPath: claudeDir)
                        }
                    }
                }
        }
        .windowStyle(.automatic)
        .defaultSize(width: 1400, height: 900)

        Settings {
            SettingsView(settings: appSettings)
        }
    }
}
