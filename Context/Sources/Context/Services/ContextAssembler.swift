import Foundation
import GRDB

struct ContextAssembler {
    /// Assemble context for a specific project. Returns a text preamble.
    /// If `projectProfile` is provided, it's prepended as codebase context.
    static func projectContext(projectId: String, projectName: String, projectPath: String, projectProfile: String? = nil) -> String {
        var parts: [String] = []
        var totalChars = 0
        let maxChars = projectProfile != nil ? 12_000 : 8_000

        parts.append("""
        You are a helpful assistant with deep context about the "\(projectName)" project.
        Project path: \(projectPath)

        Answer questions about this project's tasks, sessions, notes, architecture, and codebase.
        When referencing tasks, include their status and priority. Be concise and specific.
        """)
        totalChars += parts.last!.count

        // Project profile (codebase structure, tech stack, architecture)
        if let profile = projectProfile, !profile.isEmpty {
            parts.append(profile)
            totalChars += profile.count
        }

        // Active tasks
        if let tasks = try? DatabaseService.shared.dbQueue.read({ db in
            try TaskItem
                .filter(Column("projectId") == projectId)
                .filter(Column("status") != "done")
                .order(Column("priority").desc, Column("createdAt").desc)
                .limit(20)
                .fetchAll(db)
        }), !tasks.isEmpty {
            var section = "\nACTIVE TASKS (\(tasks.count)):\n"
            for task in tasks {
                let priority = TaskItem.Priority(rawValue: task.priority)?.label ?? "None"
                let labels = task.labelsArray.joined(separator: ", ")
                section += "- [\(priority.uppercased())] \(task.title) (status: \(task.status)"
                if !labels.isEmpty { section += ", labels: \(labels)" }
                section += ")\n"
                if let desc = task.description, !desc.isEmpty {
                    section += "  \(String(desc.prefix(120)))\n"
                }
            }
            if totalChars + section.count < maxChars {
                parts.append(section)
                totalChars += section.count
            }
        }

        // Pinned notes (full content, highest priority)
        if let notes = try? DatabaseService.shared.dbQueue.read({ db in
            try Note
                .filter(Column("projectId") == projectId)
                .filter(Column("pinned") == true)
                .order(Column("updatedAt").desc)
                .limit(5)
                .fetchAll(db)
        }), !notes.isEmpty {
            var section = "\nPINNED NOTES:\n"
            for note in notes {
                let content = String(note.content.prefix(500))
                section += "## \(note.title)\n\(content)\n\n"
            }
            if totalChars + section.count < maxChars {
                parts.append(section)
                totalChars += section.count
            }
        }

        // Recent sessions
        if let sessions = try? DatabaseService.shared.dbQueue.read({ db in
            try Session
                .filter(Column("projectId") == projectId)
                .order(Column("startedAt").desc)
                .limit(5)
                .fetchAll(db)
        }), !sessions.isEmpty {
            var section = "\nRECENT SESSIONS:\n"
            for session in sessions {
                let date = session.startedAt?.formatted(.dateTime.month(.abbreviated).day()) ?? "?"
                let summary = session.summary ?? "No summary"
                let model = session.model ?? "unknown"
                section += "- \(date): \"\(String(summary.prefix(150)))\" (\(model))\n"
            }
            if totalChars + section.count < maxChars {
                parts.append(section)
                totalChars += section.count
            }
        }

        // Recent notes (titles only)
        if let notes = try? DatabaseService.shared.dbQueue.read({ db in
            try Note
                .filter(Column("projectId") == projectId)
                .filter(Column("pinned") == false)
                .order(Column("updatedAt").desc)
                .limit(10)
                .fetchAll(db)
        }), !notes.isEmpty {
            var section = "\nRECENT NOTES:\n"
            for note in notes {
                section += "- \(note.title)\n"
            }
            if totalChars + section.count < maxChars {
                parts.append(section)
                totalChars += section.count
            }
        }

        return parts.joined(separator: "\n")
    }

    /// Assemble context for the global/home view.
    static func globalContext() -> String {
        var parts: [String] = []
        var totalChars = 0
        let maxChars = 8_000

        parts.append("""
        You are a helpful assistant with context about all projects in this workspace.
        Answer questions about projects, tasks, sessions, and notes across the entire workspace.
        Be concise and specific.
        """)
        totalChars += parts.last!.count

        // All projects with task counts
        if let projects = try? DatabaseService.shared.dbQueue.read({ db in
            try Project.order(Column("lastOpened").desc).fetchAll(db)
        }), !projects.isEmpty {
            var section = "\nPROJECTS (\(projects.count)):\n"
            for project in projects.prefix(20) {
                let taskCount = (try? DatabaseService.shared.dbQueue.read { db in
                    try TaskItem.filter(Column("projectId") == project.id).filter(Column("status") != "done").fetchCount(db)
                }) ?? 0
                let lastActive = project.lastOpened?.formatted(.dateTime.month(.abbreviated).day()) ?? "never"
                section += "- \(project.name): \(taskCount) active tasks, last active \(lastActive)\n"
            }
            if totalChars + section.count < maxChars {
                parts.append(section)
                totalChars += section.count
            }
        }

        // Global tasks
        if let tasks = try? DatabaseService.shared.dbQueue.read({ db in
            try TaskItem
                .filter(Column("isGlobal") == true)
                .filter(Column("status") != "done")
                .order(Column("priority").desc)
                .limit(15)
                .fetchAll(db)
        }), !tasks.isEmpty {
            var section = "\nGLOBAL TASKS (\(tasks.count)):\n"
            for task in tasks {
                let priority = TaskItem.Priority(rawValue: task.priority)?.label ?? "None"
                section += "- [\(priority.uppercased())] \(task.title) (status: \(task.status))\n"
            }
            if totalChars + section.count < maxChars {
                parts.append(section)
                totalChars += section.count
            }
        }

        // Global pinned notes
        if let notes = try? DatabaseService.shared.dbQueue.read({ db in
            try Note
                .filter(Column("isGlobal") == true)
                .filter(Column("pinned") == true)
                .order(Column("updatedAt").desc)
                .limit(5)
                .fetchAll(db)
        }), !notes.isEmpty {
            var section = "\nGLOBAL PINNED NOTES:\n"
            for note in notes {
                section += "## \(note.title)\n\(String(note.content.prefix(400)))\n\n"
            }
            if totalChars + section.count < maxChars {
                parts.append(section)
                totalChars += section.count
            }
        }

        return parts.joined(separator: "\n")
    }
}
