import SwiftUI
import WebKit
import Combine

/// Hosts the Agent Arena HTML5 canvas renderer in a WKWebView.
/// Pushes agent state from AgentArenaDataSource to the renderer via JS bridge.
struct AgentArenaView: View {
    @EnvironmentObject var liveMonitor: LiveSessionMonitor
    @StateObject private var agentMonitor = AgentMonitor()
    @StateObject private var dataSource = AgentArenaDataSource()
    @State private var isFloating = true
    @State private var isBound = false

    // The WKWebView reference for JS evaluation
    @State private var webViewRef: WKWebView?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ArenaWebView(webViewRef: $webViewRef)

            // Pin/unpin floating toggle
            Button(action: toggleFloating) {
                Image(systemName: isFloating ? "pin.fill" : "pin.slash")
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.6))
                    .padding(6)
                    .background(Color.black.opacity(0.3))
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
            .padding(8)
            .help(isFloating ? "Unpin from top" : "Pin to top")
        }
        .background(Color.black)
        .onAppear {
            if !isBound {
                // Start global monitoring (scans all processes for Claude, not tied to one shell)
                agentMonitor.startGlobal()
                dataSource.bind(agentMonitor: agentMonitor, liveMonitor: liveMonitor)
                isBound = true
            }
            startPushTimer()
        }
        .onDisappear {
            agentMonitor.stop()
        }
        .onReceive(dataSource.$arenaState) { _ in
            pushStateToWebView()
        }
    }

    private func pushStateToWebView() {
        guard let webView = webViewRef,
              let json = dataSource.jsonString() else { return }
        let js = "if(typeof updateAgentState==='function')updateAgentState(\(json))"
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    /// Start a 3-second timer to push state updates.
    /// This is a simple MVP approach -- the data source also publishes on change.
    private func startPushTimer() {
        Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { _ in
            DispatchQueue.main.async {
                pushStateToWebView()
            }
        }
    }

    private func toggleFloating() {
        isFloating.toggle()
        DispatchQueue.main.async {
            for window in NSApp.windows {
                if window.identifier?.rawValue == "codefire-arena" {
                    window.level = isFloating ? .floating : .normal
                    break
                }
            }
        }
    }
}

// MARK: - WKWebView Wrapper

struct ArenaWebView: NSViewRepresentable {
    @Binding var webViewRef: WKWebView?

    func makeCoordinator() -> Coordinator { Coordinator() }

    class Coordinator: NSObject, WKNavigationDelegate {
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("[Arena] Navigation failed: \(error)")
        }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("[Arena] Provisional navigation failed: \(error)")
        }
    }

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")

        // Load the arena HTML from the bundle
        // Use loadHTMLString instead of loadFileURL to avoid sandbox issues
        // when running as a bare SPM binary (not a .app bundle)
        if let htmlURL = Bundle.module.url(forResource: "agent-arena", withExtension: "html"),
           let htmlString = try? String(contentsOf: htmlURL, encoding: .utf8) {
            webView.loadHTMLString(htmlString, baseURL: htmlURL.deletingLastPathComponent())
        }

        DispatchQueue.main.async {
            self.webViewRef = webView
        }

        return webView
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

// MARK: - Arena Window Tagger

/// Tags the arena window with identifier and sets floating level on appear.
struct ArenaWindowTagger: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            if let window = view.window {
                window.identifier = NSUserInterfaceItemIdentifier("codefire-arena")
                window.level = .floating
                window.titlebarAppearsTransparent = true
                window.titleVisibility = .hidden
                window.backgroundColor = NSColor(red: 0.04, green: 0.04, blue: 0.1, alpha: 1)
                window.isMovableByWindowBackground = true
                window.styleMask.insert(.fullSizeContentView)
            }
        }
        return view
    }
    func updateNSView(_ nsView: NSView, context: Context) {}
}
