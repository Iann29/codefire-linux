import Foundation
import Combine

/// Merges AgentMonitor process data with LiveSessionMonitor session data
/// into a unified JSON payload for the Agent Arena HTML renderer.
@MainActor
final class AgentArenaDataSource: ObservableObject {

    // MARK: - JSON Models

    struct ArenaState: Codable {
        var orchestrator: OrchestratorState?
        var agents: [AgentState]
    }

    struct OrchestratorState: Codable {
        var active: Bool
        var elapsed: Int
    }

    struct AgentState: Codable {
        var id: String
        var type: String
        var state: String  // "active", "idle", "frozen"
        var elapsed: Int
    }

    // MARK: - Published State

    @Published var arenaState = ArenaState(orchestrator: nil, agents: [])

    private var cancellables = Set<AnyCancellable>()

    // MARK: - Binding

    /// Subscribe to AgentMonitor and LiveSessionMonitor changes.
    /// Merges their data into arenaState every time either changes.
    func bind(agentMonitor: AgentMonitor, liveMonitor: LiveSessionMonitor) {
        // AgentMonitor is not @MainActor but publishes on main queue.
        // LiveSessionMonitor is @MainActor. Combine on main scheduler.
        agentMonitor.$claudeProcess
            .combineLatest(agentMonitor.$agents, liveMonitor.$state)
            .throttle(for: .seconds(1), scheduler: DispatchQueue.main, latest: true)
            .sink { [weak self] claude, agents, sessionState in
                self?.update(claude: claude, agents: agents, sessionState: sessionState)
            }
            .store(in: &cancellables)
    }

    // MARK: - State Merging

    private func update(
        claude: AgentMonitor.AgentInfo?,
        agents: [AgentMonitor.AgentInfo],
        sessionState: LiveSessionState
    ) {
        var newState = ArenaState(orchestrator: nil, agents: [])

        // Orchestrator
        if let claude = claude {
            newState.orchestrator = OrchestratorState(
                active: !agents.isEmpty,
                elapsed: claude.elapsedSeconds
            )
        }

        // Extract agent types from recent "Task" tool_use activity items
        let agentTypes = extractAgentTypes(from: sessionState)

        // Map each agent process to an AgentState
        for (index, agent) in agents.enumerated() {
            let agentStateStr: String
            if agent.isPotentiallyFrozen {
                agentStateStr = "frozen"
            } else {
                agentStateStr = "active"
            }

            // Try to match agent type from session data by position
            let type = index < agentTypes.count ? agentTypes[index] : "Agent"

            newState.agents.append(AgentState(
                id: String(agent.id),
                type: type,
                state: agentStateStr,
                elapsed: agent.elapsedSeconds
            ))
        }

        arenaState = newState
    }

    /// Look through recent activity for "Task" tool invocations to determine agent types.
    /// The detail string for tool_use entries is formatted as "ToolName  description".
    private func extractAgentTypes(from sessionState: LiveSessionState) -> [String] {
        var types: [String] = []
        for activity in sessionState.recentActivity {
            if case .toolUse(let toolName) = activity.type,
               toolName == "Task" || toolName == "Agent" {
                let detail = activity.detail
                // detail format: "ToolName  description"
                if detail.contains("  ") {
                    let parts = detail.components(separatedBy: "  ")
                    if parts.count > 1 {
                        let desc = parts[1].trimmingCharacters(in: .whitespaces)
                        types.append(desc)
                    }
                } else {
                    types.append("Agent")
                }
            }
        }
        return types
    }

    // MARK: - JSON Output

    /// Encode the current arena state as a JSON string for the WebView.
    func jsonString() -> String? {
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(arenaState),
              let json = String(data: data, encoding: .utf8) else {
            return nil
        }
        return json
    }
}
