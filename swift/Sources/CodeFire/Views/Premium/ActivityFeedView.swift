import SwiftUI

struct ActivityFeedView: View {
    @EnvironmentObject var appState: AppState
    @State private var events: [ActivityEvent] = []
    @State private var summaries: [SessionSummary] = []
    @State private var showSummaries = false
    @State private var isLoading = false

    private var premiumService: PremiumService { PremiumService.shared }

    var body: some View {
        VStack(spacing: 0) {
            // Header with toggle
            HStack(spacing: 12) {
                Text("Activity")
                    .font(.system(size: 13, weight: .semibold))

                Spacer()

                Picker("View", selection: $showSummaries) {
                    Text("Events").tag(false)
                    Text("Summaries").tag(true)
                }
                .pickerStyle(.segmented)
                .frame(width: 200)

                Button {
                    Task { await loadData() }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11))
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)

            Divider()

            if isLoading {
                ProgressView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if showSummaries {
                summariesList
            } else {
                eventsList
            }
        }
        .task {
            await loadData()
        }
    }

    // MARK: - Events List

    private var eventsList: some View {
        Group {
            if events.isEmpty {
                emptyState(icon: "waveform.path.ecg", message: "No activity yet", detail: "Team activity events will appear here.")
            } else {
                ScrollView {
                    LazyVStack(spacing: 2) {
                        ForEach(events) { event in
                            ActivityEventRow(event: event)
                        }
                    }
                    .padding(12)
                }
            }
        }
    }

    // MARK: - Summaries List

    private var summariesList: some View {
        Group {
            if summaries.isEmpty {
                emptyState(icon: "doc.text", message: "No session summaries", detail: "Share session summaries with your team.")
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(summaries) { summary in
                            SessionSummaryCard(summary: summary)
                        }
                    }
                    .padding(12)
                }
            }
        }
    }

    // MARK: - Empty State

    private func emptyState(icon: String, message: String, detail: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 28))
                .foregroundColor(.secondary.opacity(0.5))
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.secondary)
            Text(detail)
                .font(.system(size: 11))
                .foregroundColor(.secondary.opacity(0.7))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Data Loading

    private func loadData() async {
        guard let projectId = appState.currentProject?.id else { return }
        isLoading = true
        do {
            events = try await premiumService.getActivityFeed(projectId: projectId)
            summaries = try await premiumService.listSessionSummaries(projectId: projectId)
        } catch {
            print("ActivityFeed: failed to load: \(error)")
        }
        isLoading = false
    }
}

// MARK: - Activity Event Row

struct ActivityEventRow: View {
    let event: ActivityEvent

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Event type icon
            Image(systemName: iconForEventType(event.eventType))
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(colorForEventType(event.eventType))
                .frame(width: 24, height: 24)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(colorForEventType(event.eventType).opacity(0.12))
                )

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    if let user = event.user {
                        Text(user.displayName)
                            .font(.system(size: 12, weight: .medium))
                    }
                    Text(descriptionForEvent(event))
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                }

                Text(event.entityType)
                    .font(.system(size: 10))
                    .foregroundColor(.secondary.opacity(0.7))
            }

            Spacer()

            Text(relativeTime(event.createdAt))
                .font(.system(size: 10))
                .foregroundColor(.secondary.opacity(0.6))
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(Color(nsColor: .controlBackgroundColor).opacity(0.5))
        )
    }

    private func iconForEventType(_ type: String) -> String {
        switch type {
        case "task_created": return "plus.circle"
        case "task_completed": return "checkmark.circle"
        case "task_updated": return "pencil"
        case "note_created": return "note.text"
        case "note_updated": return "note.text"
        case "session_started": return "play.circle"
        case "session_ended": return "stop.circle"
        case "review_requested": return "arrow.triangle.pull"
        case "review_resolved": return "checkmark.seal"
        case "doc_created": return "doc.badge.plus"
        case "doc_updated": return "doc"
        case "commit": return "arrow.triangle.branch"
        default: return "circle"
        }
    }

    private func colorForEventType(_ type: String) -> Color {
        switch type {
        case "task_created", "doc_created", "note_created": return .green
        case "task_completed", "review_resolved": return .blue
        case "task_updated", "note_updated", "doc_updated": return .orange
        case "session_started": return .purple
        case "session_ended": return .secondary
        case "review_requested": return .yellow
        case "commit": return .cyan
        default: return .secondary
        }
    }

    private func descriptionForEvent(_ event: ActivityEvent) -> String {
        switch event.eventType {
        case "task_created": return "created a task"
        case "task_completed": return "completed a task"
        case "task_updated": return "updated a task"
        case "note_created": return "created a note"
        case "note_updated": return "updated a note"
        case "session_started": return "started a session"
        case "session_ended": return "ended a session"
        case "review_requested": return "requested a review"
        case "review_resolved": return "resolved a review"
        case "doc_created": return "created a doc"
        case "doc_updated": return "updated a doc"
        case "commit": return "pushed a commit"
        default: return event.eventType.replacingOccurrences(of: "_", with: " ")
        }
    }

    private func relativeTime(_ dateString: String) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: dateString) else { return dateString }

        let interval = Date().timeIntervalSince(date)
        if interval < 60 { return "just now" }
        if interval < 3600 { return "\(Int(interval / 60))m ago" }
        if interval < 86400 { return "\(Int(interval / 3600))h ago" }
        return "\(Int(interval / 86400))d ago"
    }
}

// MARK: - Session Summary Card

struct SessionSummaryCard: View {
    let summary: SessionSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if let branch = summary.gitBranch {
                    Label(branch, systemImage: "arrow.triangle.branch")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.accentColor)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(
                            Capsule().fill(Color.accentColor.opacity(0.1))
                        )
                }

                if let model = summary.model {
                    Text(model)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }

                Spacer()

                if let mins = summary.durationMins {
                    Text("\(mins) min")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.secondary)
                }
            }

            Text(summary.summary)
                .font(.system(size: 12))
                .lineLimit(4)
                .foregroundColor(.primary)

            if !summary.filesChanged.isEmpty {
                HStack(spacing: 4) {
                    Image(systemName: "doc")
                        .font(.system(size: 9))
                        .foregroundColor(.secondary)
                    Text("\(summary.filesChanged.count) files changed")
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                }
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(nsColor: .controlBackgroundColor))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color(nsColor: .separatorColor).opacity(0.3), lineWidth: 0.5)
                )
        )
    }
}
