import SwiftUI

@main
struct ContextApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
        .windowStyle(.automatic)
        .defaultSize(width: 1400, height: 900)
    }
}

struct ContentView: View {
    var body: some View {
        HSplitView {
            Text("Terminal")
                .frame(minWidth: 400, maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(nsColor: .textBackgroundColor))
            Text("GUI Panel")
                .frame(minWidth: 400, maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}
