import SwiftUI
import AppKit

struct MainSplitView: View {
    @EnvironmentObject var appState: AppState
    @State private var projectPath: String = ""

    var body: some View {
        HSplitView {
            ProjectSidebarView()
                .frame(minWidth: 160, maxWidth: 240)

            TerminalTabView(projectPath: $projectPath)
                .frame(minWidth: 400, idealWidth: 600)

            GUIPanelView()
                .frame(minWidth: 400, idealWidth: 600)
        }
        .background(Color(nsColor: .windowBackgroundColor))
        .ignoresSafeArea()
        .background(WindowConfigurator())
        .onChange(of: appState.currentProject) { _, project in
            if let project = project {
                projectPath = project.path
            }
        }
    }
}

/// Configures the hosting NSWindow for a seamless title-bar appearance.
struct WindowConfigurator: NSViewRepresentable {
    typealias NSViewType = NSView

    func makeNSView(context: NSViewRepresentableContext<WindowConfigurator>) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            guard let window = view.window else { return }
            window.titlebarAppearsTransparent = true
            window.titleVisibility = .hidden
            window.backgroundColor = .windowBackgroundColor
            // Let content extend under the title bar
            window.styleMask.insert(.fullSizeContentView)
            // Remove the toolbar separator line
            if window.toolbar == nil {
                window.toolbar = NSToolbar()
            }
            window.toolbar?.showsBaselineSeparator = false
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: NSViewRepresentableContext<WindowConfigurator>) {}
}
