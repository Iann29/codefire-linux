import Foundation
import Combine

/// Monitors the process tree under a shell PID to detect running Claude Code agents.
///
/// Claude Code spawns background agents (Task tool) as child processes:
///   zsh (shell) → node …/claude (main) → node …/claude (agent 1), node …/claude (agent 2)
///
/// Polls `ps` every 3 seconds to detect and track these agents.
class AgentMonitor: ObservableObject {

    struct AgentInfo: Identifiable, Equatable {
        let id: Int          // PID
        let parentPid: Int
        let elapsed: String  // ps etime: [[dd-]hh:]mm:ss
        let command: String  // readable short name
        let depth: Int       // depth in tree from shell (1 = direct child)

        /// Elapsed time in seconds.
        var elapsedSeconds: Int {
            // etime: "ss", "mm:ss", "hh:mm:ss", "dd-hh:mm:ss"
            let normalized = elapsed.replacingOccurrences(of: "-", with: ":")
            let parts = normalized.split(separator: ":").compactMap { Int($0) }
            switch parts.count {
            case 1: return parts[0]
            case 2: return parts[0] * 60 + parts[1]
            case 3: return parts[0] * 3600 + parts[1] * 60 + parts[2]
            case 4: return parts[0] * 86400 + parts[1] * 3600 + parts[2] * 60 + parts[3]
            default: return 0
            }
        }

        var isPotentiallyFrozen: Bool { elapsedSeconds > 180 }

        var formattedElapsed: String {
            let s = elapsedSeconds
            if s < 60 { return "\(s)s" }
            if s < 3600 { return "\(s / 60)m \(s % 60)s" }
            return "\(s / 3600)h \((s % 3600) / 60)m"
        }
    }

    @Published var agents: [AgentInfo] = []       // background agents (children of main claude)
    @Published var claudeProcess: AgentInfo? = nil // the main claude process
    @Published var isMonitoring = false

    private var timer: Timer?
    private var shellPid: pid_t = 0

    func start(shellPid: pid_t) {
        guard shellPid > 0 else { return }
        // Stop any existing polling before restarting
        timer?.invalidate()
        self.shellPid = shellPid
        isMonitoring = true
        poll()
        timer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in
            self?.poll()
        }
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        isMonitoring = false
        DispatchQueue.main.async {
            self.agents = []
            self.claudeProcess = nil
        }
    }

    // MARK: - Polling

    private func poll() {
        DispatchQueue.global(qos: .utility).async { [weak self] in
            guard let self, self.shellPid > 0 else { return }
            let (claude, agents) = self.scan()
            DispatchQueue.main.async {
                self.claudeProcess = claude
                self.agents = agents
            }
        }
    }

    // MARK: - Process Tree Scanner

    private struct ProcRecord {
        let pid: Int
        let ppid: Int
        let etime: String
        let command: String
    }

    private func scan() -> (claude: AgentInfo?, agents: [AgentInfo]) {
        let records = fetchProcesses()
        guard !records.isEmpty else { return (nil, []) }

        // Build parent → children map
        var childrenOf: [Int: [Int]] = [:]
        var procMap: [Int: ProcRecord] = [:]
        for r in records {
            procMap[r.pid] = r
            childrenOf[r.ppid, default: []].append(r.pid)
        }

        // BFS from shell to find all descendants with their depth
        var descendantDepth: [Int: Int] = [:] // pid → depth from shell
        var queue: [(Int, Int)] = [(Int(shellPid), 0)]
        while !queue.isEmpty {
            let (pid, depth) = queue.removeFirst()
            for child in childrenOf[pid] ?? [] {
                guard descendantDepth[child] == nil else { continue }
                descendantDepth[child] = depth + 1
                queue.append((child, depth + 1))
            }
        }

        // Find claude processes among descendants
        var claudeDescs: [(ProcRecord, Int)] = [] // (record, depth)
        for (pid, depth) in descendantDepth {
            guard let proc = procMap[pid] else { continue }
            if isClaude(proc.command) {
                claudeDescs.append((proc, depth))
            }
        }

        guard !claudeDescs.isEmpty else { return (nil, []) }

        // Main claude = shallowest depth
        claudeDescs.sort { $0.1 < $1.1 }
        let main = claudeDescs[0]

        let claudeInfo = AgentInfo(
            id: main.0.pid,
            parentPid: main.0.ppid,
            elapsed: main.0.etime,
            command: "Claude Code",
            depth: main.1
        )

        // Agents = all other claude processes that are descendants of the main claude
        let mainPid = main.0.pid
        var agentInfos: [AgentInfo] = []

        for (proc, depth) in claudeDescs.dropFirst() {
            // Walk up from proc to see if mainPid is an ancestor
            var cursor = proc.ppid
            var isChild = false
            for _ in 0..<10 { // max 10 hops
                if cursor == mainPid { isChild = true; break }
                guard let parent = procMap[cursor] else { break }
                cursor = parent.ppid
            }
            if isChild {
                agentInfos.append(AgentInfo(
                    id: proc.pid,
                    parentPid: proc.ppid,
                    elapsed: proc.etime,
                    command: "Agent",
                    depth: depth
                ))
            }
        }

        return (claudeInfo, agentInfos)
    }

    private func fetchProcesses() -> [ProcRecord] {
        let task = Process()
        task.executableURL = URL(fileURLWithPath: "/bin/ps")
        task.arguments = ["-eo", "pid,ppid,etime,command"]
        let pipe = Pipe()
        task.standardOutput = pipe
        task.standardError = FileHandle.nullDevice
        do { try task.run() } catch { return [] }
        task.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let output = String(data: data, encoding: .utf8) else { return [] }

        var records: [ProcRecord] = []
        for line in output.split(separator: "\n").dropFirst() {
            let cols = line.split(separator: " ", maxSplits: 3, omittingEmptySubsequences: true)
            guard cols.count >= 4,
                  let pid = Int(cols[0]),
                  let ppid = Int(cols[1]) else { continue }
            records.append(ProcRecord(
                pid: pid,
                ppid: ppid,
                etime: String(cols[2]),
                command: String(cols[3])
            ))
        }
        return records
    }

    private func isClaude(_ command: String) -> Bool {
        command.contains("claude") && (
            command.contains("@anthropic") ||
            command.contains("claude-code") ||
            command.contains("/claude ") ||
            command.hasSuffix("/claude")
        )
    }
}
