# Context

A native macOS companion app for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) that gives you visibility and control across all your projects from a single interface.

Context auto-discovers your Claude Code projects, tracks tasks and sessions, monitors live coding activity, and exposes project data back to Claude via MCP — creating a feedback loop where Claude knows what you're working on and can act on it.

## What It Does

**Project management dashboard** — Auto-discovers all your Claude Code projects from `~/.claude/projects/`. Each project opens in its own dedicated window with an integrated terminal and tabbed GUI panel. The home view shows a global planner with tasks aggregated across all projects.

**Task tracking with Kanban board** — Drag-and-drop Kanban board (Todo / In Progress / Done) per project and globally. Tasks can be created manually, extracted from emails, or created programmatically by Claude through the MCP server. Priority levels, labels, notes, and full task history.

**Live session monitoring** — Real-time mission control for active Claude Code sessions. Watches the session JSONL file and displays token usage, cost tracking, tools invoked, files touched, and a live activity feed. Pulsing indicator when Claude is actively working.

**Session history** — Parses and indexes all past Claude Code sessions. Browse conversations, see what Claude did, review tool usage patterns, and track costs over time.

**Built-in terminal** — Tabbed terminal emulator (SwiftTerm) embedded directly in each project window. Launch Claude Code sessions, run commands, manage multiple terminal tabs — all without leaving the app.

**GitHub integration** — Shows open PRs, CI/Actions status, recent commits on the default branch, and your assigned issues. Polls via `gh` CLI every 60 seconds. Click any item to open it in your browser.

**CLAUDE.md editor** — Read and edit your project's `CLAUDE.md` and `~/.claude/CLAUDE.md` files directly in the app. Syntax-highlighted editor with save support.

**Memory viewer** — Browse Claude Code's memory files and project-specific patterns from `~/.claude/`.

**Notes** — Per-project and global notes with a rich editor. Pin important notes, search across all notes, and use them to persist context between sessions.

**Chat with Claude** — Side-panel chat drawer that talks to Claude with full project context injected automatically. Claude sees your tasks, sessions, codebase profile, and notes — so it can answer questions about your project without you re-explaining everything.

**Project profiling** — Automatically scans each project's file tree, detects the tech stack, analyzes architecture patterns, and generates a codebase profile. This profile is injected into chat context and exposed via MCP.

**Gmail integration** — Connects to Gmail via OAuth, polls for emails matching configurable whitelist rules, triages them with Claude, and auto-creates tasks. Supports multiple accounts.

**Agent monitoring** — Detects Claude Code background agents (Task tool subprocesses) running in your terminal and displays them in a status bar with elapsed time.

**Built-in browser** — WebKit browser panel for quick reference without leaving the app. Includes screenshot capture with annotation tools.

## MCP Server

Context includes a companion MCP server (`ContextMCP`) that exposes your project data to Claude Code. When configured, Claude can:

- List and manage tasks (create, update status, add notes)
- Read project notes and search across them
- Access the codebase profile and file tree
- Query session history
- Work with client groupings

This creates a powerful loop: you manage work in Context, and Claude has full awareness of that work during coding sessions.

### MCP Configuration

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "context-tasks": {
      "command": "/Applications/Context.app/Contents/MacOS/ContextMCP"
    }
  }
}
```

## Requirements

- macOS 14.0 (Sonoma) or later
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- [GitHub CLI](https://cli.github.com/) (`gh`) for the GitHub tab
- Swift 5.9+ toolchain (for building from source)

## Building from Source

```bash
git clone https://github.com/websitebutlers/claude-context-tasks.git
cd claude-context-tasks
bash scripts/package-app.sh
```

This builds a release binary, generates the app icon, assembles `Context.app`, and codesigns it. The output lands in `build/Context.app`.

To install:

```bash
cp -r build/Context.app /Applications/
```

## Architecture

Context is a pure Swift Package Manager project with two executable targets:

| Target | Description |
|--------|-------------|
| `Context` | Main GUI app — SwiftUI + AppKit, no Xcode project needed |
| `ContextMCP` | Standalone MCP server binary, communicates via stdio |

### Dependencies

| Package | Purpose |
|---------|---------|
| [GRDB.swift](https://github.com/groue/GRDB.swift) | SQLite database (shared between app and MCP server) |
| [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm) | Terminal emulator |

No Electron. No web views (except the built-in browser). No node_modules. The entire app is ~16MB.

### Key Services

| Service | What it does |
|---------|-------------|
| `ProjectDiscovery` | Decodes `~/.claude/projects/` directory names back to real paths |
| `SessionWatcher` | Watches for new/changed session JSONL files |
| `LiveSessionMonitor` | Parses active session files in real-time for the live dashboard |
| `ProjectProfileGenerator` | Scans projects for tech stack, architecture, and file structure |
| `GitHubService` | Polls GitHub via `gh` CLI for PRs, CI, commits, and issues |
| `AgentMonitor` | Detects Claude Code subagent processes via the process tree |
| `DevEnvironment` | Scans for dev tools, package managers, and project configuration |
| `GmailPoller` | Fetches and triages emails into tasks via Gmail API + Claude |
| `ContextAssembler` | Composes project context for the chat drawer |
| `DatabaseService` | SQLite via GRDB, shared between the app and MCP server |

### Data Storage

All data lives in `~/Library/Application Support/Context/context.db` — a single SQLite database shared by both the GUI app and the MCP server. MCP connection status files are written to `~/Library/Application Support/Context/mcp-connections/`.

## Project Structure

```
Context/
  Sources/
    Context/           # Main app target
      ContextApp.swift
      Views/
        Browser/       # Built-in WebKit browser
        Chat/          # Claude chat drawer
        Dashboard/     # Live session + stats
        GitHub/        # PR, CI, commit, issue views
        Home/          # Global planner + email summary
        Memory/        # Claude memory file viewer
        Notes/         # Note editor
        Rules/         # CLAUDE.md editor
        Sessions/      # Session history browser
        Sidebar/       # Project navigation
        Tasks/         # Kanban board
        Visualize/     # Architecture maps (experimental)
      ViewModels/
        AppState.swift
      Services/        # All backend services
      Models/          # GRDB data models
    ContextMCP/        # MCP server target
      main.swift
  Package.swift
scripts/
  package-app.sh       # Build + bundle + codesign
  generate-icon.swift   # Programmatic app icon
```

## License

MIT
