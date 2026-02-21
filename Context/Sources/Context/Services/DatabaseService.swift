import Foundation
import GRDB

class DatabaseService {
    static let shared = DatabaseService()
    private(set) var dbQueue: DatabaseQueue!

    private init() {}

    func setup() throws {
        let appSupportURL = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!.appendingPathComponent("Context", isDirectory: true)

        try FileManager.default.createDirectory(
            at: appSupportURL,
            withIntermediateDirectories: true
        )

        let dbPath = appSupportURL.appendingPathComponent("context.db").path
        dbQueue = try DatabaseQueue(path: dbPath)

        try migrator.migrate(dbQueue)
    }

    private var migrator: DatabaseMigrator {
        var migrator = DatabaseMigrator()

        migrator.registerMigration("v1_createTables") { db in
            try db.create(table: "projects") { t in
                t.primaryKey("id", .text)
                t.column("name", .text).notNull()
                t.column("path", .text).notNull().unique()
                t.column("claudeProject", .text)
                t.column("lastOpened", .datetime)
                t.column("createdAt", .datetime).notNull()
            }

            try db.create(table: "sessions") { t in
                t.primaryKey("id", .text)
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("slug", .text)
                t.column("startedAt", .datetime)
                t.column("endedAt", .datetime)
                t.column("model", .text)
                t.column("gitBranch", .text)
                t.column("summary", .text)
                t.column("messageCount", .integer).notNull().defaults(to: 0)
                t.column("toolUseCount", .integer).notNull().defaults(to: 0)
                t.column("filesChanged", .text)
            }

            try db.create(table: "codebaseSnapshots") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("capturedAt", .datetime).notNull()
                t.column("fileTree", .text)
                t.column("schemaHash", .text)
                t.column("keySymbols", .text)
            }

            try db.create(table: "notes") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("title", .text).notNull()
                t.column("content", .text).notNull().defaults(to: "")
                t.column("pinned", .boolean).notNull().defaults(to: false)
                t.column("sessionId", .text)
                    .references("sessions", onDelete: .setNull)
                t.column("createdAt", .datetime).notNull()
                t.column("updatedAt", .datetime).notNull()
            }

            try db.create(table: "patterns") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("category", .text).notNull()
                t.column("title", .text).notNull()
                t.column("description", .text).notNull()
                t.column("sourceSession", .text)
                    .references("sessions", onDelete: .setNull)
                t.column("autoDetected", .boolean).notNull().defaults(to: false)
                t.column("createdAt", .datetime).notNull()
            }

            try db.create(table: "taskItems") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("title", .text).notNull()
                t.column("description", .text)
                t.column("status", .text).notNull().defaults(to: "todo")
                t.column("priority", .integer).notNull().defaults(to: 0)
                t.column("sourceSession", .text)
                    .references("sessions", onDelete: .setNull)
                t.column("source", .text).notNull().defaults(to: "manual")
                t.column("createdAt", .datetime).notNull()
                t.column("completedAt", .datetime)
            }
        }

        migrator.registerMigration("v2_addTokenColumns") { db in
            try db.alter(table: "sessions") { t in
                t.add(column: "inputTokens", .integer).notNull().defaults(to: 0)
                t.add(column: "outputTokens", .integer).notNull().defaults(to: 0)
                t.add(column: "cacheCreationTokens", .integer).notNull().defaults(to: 0)
                t.add(column: "cacheReadTokens", .integer).notNull().defaults(to: 0)
            }
        }

        migrator.registerMigration("v3_addTaskLabels") { db in
            try db.alter(table: "taskItems") { t in
                t.add(column: "labels", .text) // JSON array of strings
            }
        }

        migrator.registerMigration("v4_addTaskAttachments") { db in
            try db.alter(table: "taskItems") { t in
                t.add(column: "attachments", .text) // JSON array of file paths
            }
        }

        migrator.registerMigration("v5_createTaskNotes") { db in
            try db.create(table: "taskNotes") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("taskId", .integer).notNull()
                    .references("taskItems", onDelete: .cascade)
                t.column("content", .text).notNull()
                t.column("source", .text).notNull().defaults(to: "manual") // "manual", "claude", "system"
                t.column("sessionId", .text) // which Claude session added this
                t.column("createdAt", .datetime).notNull()
            }
        }

        migrator.registerMigration("v1_createFTS") { db in
            // Full-text search on sessions
            try db.create(virtualTable: "sessionsFts", using: FTS5()) { t in
                t.synchronize(withTable: "sessions")
                t.column("summary")
            }

            // Full-text search on notes
            try db.create(virtualTable: "notesFts", using: FTS5()) { t in
                t.synchronize(withTable: "notes")
                t.column("title")
                t.column("content")
            }
        }

        migrator.registerMigration("v6_addClients") { db in
            try db.create(table: "clients") { t in
                t.primaryKey("id", .text)
                t.column("name", .text).notNull()
                t.column("color", .text).notNull().defaults(to: "#3B82F6")
                t.column("sortOrder", .integer).notNull().defaults(to: 0)
                t.column("createdAt", .datetime).notNull()
            }
        }

        migrator.registerMigration("v7_addProjectClientAndTags") { db in
            try db.alter(table: "projects") { t in
                t.add(column: "clientId", .text).references("clients", onDelete: .setNull)
                t.add(column: "tags", .text)
                t.add(column: "sortOrder", .integer).defaults(to: 0)
            }
        }

        migrator.registerMigration("v8_addGlobalFlags") { db in
            try db.alter(table: "taskItems") { t in
                t.add(column: "isGlobal", .boolean).notNull().defaults(to: false)
            }
            try db.alter(table: "notes") { t in
                t.add(column: "isGlobal", .boolean).notNull().defaults(to: false)
            }
        }

        migrator.registerMigration("v9_addGmailIntegration") { db in
            try db.create(table: "gmailAccounts") { t in
                t.primaryKey("id", .text)
                t.column("email", .text).notNull().unique()
                t.column("lastHistoryId", .text)
                t.column("isActive", .boolean).notNull().defaults(to: true)
                t.column("createdAt", .datetime).notNull()
                t.column("lastSyncAt", .datetime)
            }

            try db.create(table: "whitelistRules") { t in
                t.primaryKey("id", .text)
                t.column("pattern", .text).notNull()
                t.column("clientId", .text).references("clients", onDelete: .setNull)
                t.column("priority", .integer).notNull().defaults(to: 0)
                t.column("isActive", .boolean).notNull().defaults(to: true)
                t.column("createdAt", .datetime).notNull()
                t.column("note", .text)
            }

            try db.create(table: "processedEmails") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("gmailMessageId", .text).notNull().unique()
                t.column("gmailThreadId", .text).notNull()
                t.column("gmailAccountId", .text).notNull()
                    .references("gmailAccounts", onDelete: .cascade)
                t.column("fromAddress", .text).notNull()
                t.column("fromName", .text)
                t.column("subject", .text).notNull()
                t.column("snippet", .text)
                t.column("body", .text)
                t.column("receivedAt", .datetime).notNull()
                t.column("taskId", .integer)
                    .references("taskItems", onDelete: .setNull)
                t.column("triageType", .text)
                t.column("isRead", .boolean).notNull().defaults(to: false)
                t.column("repliedAt", .datetime)
                t.column("importedAt", .datetime).notNull()
            }

            try db.alter(table: "taskItems") { t in
                t.add(column: "gmailThreadId", .text)
                t.add(column: "gmailMessageId", .text)
            }
        }

        migrator.registerMigration("v10_seedGlobalProject") { db in
            // Insert a sentinel project so global tasks (email-created) satisfy the FK constraint
            let exists = try Bool.fetchOne(db, sql:
                "SELECT EXISTS(SELECT 1 FROM projects WHERE id = '__global__')"
            ) ?? false
            if !exists {
                try db.execute(
                    sql: """
                        INSERT INTO projects (id, name, path, createdAt, sortOrder)
                        VALUES ('__global__', 'Global', '', ?, -1)
                        """,
                    arguments: [Date()]
                )
            }
        }

        migrator.registerMigration("v11_createBrowserScreenshots") { db in
            try db.create(table: "browserScreenshots") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text).notNull()
                    .references("projects", onDelete: .cascade)
                t.column("filePath", .text).notNull()
                t.column("pageURL", .text)
                t.column("pageTitle", .text)
                t.column("createdAt", .datetime).notNull()
            }
        }

        migrator.registerMigration("v12_createChatTables") { db in
            try db.create(table: "chatConversations") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("projectId", .text) // nullable — null means global
                t.column("title", .text).notNull()
                t.column("createdAt", .datetime).notNull()
                t.column("updatedAt", .datetime).notNull()
            }

            try db.create(table: "chatMessages") { t in
                t.autoIncrementedPrimaryKey("id")
                t.column("conversationId", .integer).notNull()
                    .references("chatConversations", onDelete: .cascade)
                t.column("role", .text).notNull()
                t.column("content", .text).notNull()
                t.column("createdAt", .datetime).notNull()
            }
        }

        migrator.registerMigration("v13_addProfileText") { db in
            try db.alter(table: "codebaseSnapshots") { t in
                t.add(column: "profileText", .text)
            }
        }

        return migrator
    }
}
