import SwiftUI
import GRDB

struct HomeView: View {
    var body: some View {
        VSplitView {
            KanbanBoard(globalMode: true)
                .frame(minHeight: 200)
            HSplitView {
                ProjectTaskSummary()
                    .frame(minWidth: 200)
                NoteListView(globalMode: true)
                    .frame(minWidth: 200)
            }
            .frame(minHeight: 150)
        }
    }
}

// MARK: - Project Task Summary

struct ProjectTaskSummary: View {
    @EnvironmentObject var appState: AppState

    struct ProjectTaskCount: Identifiable {
        let id: String // project ID
        let name: String
        let todoCount: Int
        let inProgressCount: Int
    }

    @State private var projectTasks: [ProjectTaskCount] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            HStack {
                Image(systemName: "tray.full.fill")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.orange)
                Text("Active Tasks by Project")
                    .font(.system(size: 12, weight: .semibold))
                Spacer()
                Text("\(projectTasks.reduce(0) { $0 + $1.todoCount + $1.inProgressCount })")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Color.secondary.opacity(0.12), in: Capsule())
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)

            Divider()

            if projectTasks.isEmpty {
                VStack(spacing: 6) {
                    Image(systemName: "checkmark.circle")
                        .font(.system(size: 20))
                        .foregroundColor(.green.opacity(0.6))
                    Text("All clear")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: 1) {
                        ForEach(projectTasks) { pt in
                            projectTaskRow(pt)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .background(Color(nsColor: .underPageBackgroundColor).opacity(0.5))
        .clipShape(RoundedRectangle(cornerRadius: 8))
        .onAppear { loadProjectTasks() }
        .onReceive(NotificationCenter.default.publisher(for: .tasksDidChange)) { _ in
            loadProjectTasks()
        }
    }

    @ViewBuilder
    private func projectTaskRow(_ pt: ProjectTaskCount) -> some View {
        Button {
            if let project = appState.projects.first(where: { $0.id == pt.id }) {
                appState.selectedTab = .tasks
                appState.selectProject(project)
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "folder.fill")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
                    .frame(width: 14)

                Text(pt.name)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.primary)
                    .lineLimit(1)
                    .truncationMode(.tail)

                Spacer()

                if pt.inProgressCount > 0 {
                    HStack(spacing: 3) {
                        Circle()
                            .fill(Color.blue)
                            .frame(width: 6, height: 6)
                        Text("\(pt.inProgressCount)")
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .foregroundColor(.blue)
                    }
                }

                HStack(spacing: 3) {
                    Circle()
                        .fill(Color.orange)
                        .frame(width: 6, height: 6)
                    Text("\(pt.todoCount)")
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundColor(.orange)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            if hovering {
                NSCursor.pointingHand.push()
            } else {
                NSCursor.pop()
            }
        }
    }

    private func loadProjectTasks() {
        do {
            let results = try DatabaseService.shared.dbQueue.read { db -> [ProjectTaskCount] in
                let rows = try Row.fetchAll(db, sql: """
                    SELECT p.id, p.name,
                        SUM(CASE WHEN t.status = 'todo' THEN 1 ELSE 0 END) as todoCount,
                        SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as inProgressCount
                    FROM taskItems t
                    JOIN projects p ON p.id = t.projectId
                    WHERE t.status != 'done' AND t.isGlobal = 0
                    GROUP BY p.id
                    ORDER BY (todoCount + inProgressCount) DESC, p.name ASC
                    """)
                return rows.map { row in
                    ProjectTaskCount(
                        id: row["id"],
                        name: row["name"],
                        todoCount: row["todoCount"],
                        inProgressCount: row["inProgressCount"]
                    )
                }
            }
            projectTasks = results
        } catch {
            print("Failed to load project tasks: \(error)")
        }
    }
}
