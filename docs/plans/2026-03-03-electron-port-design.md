# CodeFire Electron Port — Design Document

**Date:** 2026-03-03
**Status:** Approved
**Goal:** Full-parity Electron version of CodeFire for Windows/Linux (and macOS), living in the same repo as the Swift version.

---

## 1. Context

CodeFire is a native macOS companion app for AI coding CLIs (Claude Code, Gemini CLI, etc.). It provides persistent task/note management, semantic code search, terminal emulation, browser automation, and more — all exposed to the CLI via an MCP server.

The Swift version has gained traction on Reddit and GitHub. Users on Windows and Linux are requesting a cross-platform version. The Electron port will provide exact feature parity while the Swift version remains the primary macOS product.

## 2. Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Full feature parity day one | Users expect the same experience across platforms |
| UI Framework | React + Tailwind CSS | Largest ecosystem, easiest contributor onboarding |
| MCP Server | Node.js (single implementation) | Runs on all platforms, one codebase to maintain |
| Database sharing | Shared `codefire.db` on macOS | Seamless switching between Swift and Electron versions |
| Build tooling | Vite + electron-builder + TypeScript | Fast dev experience, proven packaging pipeline |

## 3. Project Structure

```
claude-context-tool/
├── Context/                    # Existing Swift app (NEVER MODIFIED)
│   ├── Package.swift
│   └── Sources/
│       ├── CodeFire/           # Swift GUI
│       └── CodeFireMCP/        # Swift MCP server
├── electron/                   # Electron app
│   ├── package.json
│   ├── electron-builder.yml    # Cross-platform packaging
│   ├── tsconfig.json
│   ├── tailwind.config.ts
│   ├── vite.config.ts
│   ├── src/
│   │   ├── main/               # Electron main process (Node.js)
│   │   │   ├── index.ts        # App lifecycle, window management
│   │   │   ├── database/       # SQLite + migrations + DAOs
│   │   │   ├── services/       # Git, indexing, file watching, etc.
│   │   │   ├── mcp/            # Node.js MCP server code (shared)
│   │   │   └── ipc/            # IPC handlers (main <-> renderer)
│   │   ├── renderer/           # React + Tailwind UI
│   │   │   ├── App.tsx
│   │   │   ├── components/     # Shared UI components
│   │   │   ├── views/          # All views (tabs, panels, modals)
│   │   │   ├── hooks/          # React hooks for services
│   │   │   └── styles/         # Tailwind config + global CSS
│   │   ├── shared/             # Types, constants (both processes)
│   │   └── preload/            # Electron preload scripts
│   ├── mcp-server/             # Standalone Node.js MCP entry point
│   │   ├── index.ts
│   │   └── package.json
│   └── resources/              # Icons, platform assets
├── assets/                     # Shared marketing assets
└── README.md
```

## 4. Window Architecture

### Main Window (1400x900) — Dashboard/Planner

Two-panel layout: sidebar + dashboard content.

```
┌─────────────┬──────────────────────────────────────┐
│   Sidebar   │         Dashboard Content             │
│  (160-240)  │                                       │
│             │  Home / Planner / Global Tasks         │
│  Logo       │  Cost Summary, Live Sessions           │
│  Planner    │  Recent Activity, Task Launcher        │
│  Clients    │                                       │
│   └ Project │  (click project -> opens new window)  │
│   └ Project │                                       │
│  Actions    │                                       │
└─────────────┴──────────────────────────────────────┘
```

- Clicking a project in the sidebar opens a dedicated project window
- Global tasks, cost aggregation, and session overview live here
- Sidebar lists clients (collapsible groups) with colored indicators

### Project Window (1200x850) — Per-Project

Two-panel layout: terminal + GUI panel.

```
┌────────────────────┬───────────────────────┐
│   Terminal Panel   │     GUI Panel         │
│    (300-550)       │    (420+ flex)        │
│                    │                       │
│  Tab Bar           │  12-Tab Navigation    │
│  ┌──────────────┐  │  ┌─────────────────┐ │
│  │   xterm.js   │  │  │  Active View    │ │
│  │              │  │  │                 │ │
│  └──────────────┘  │  └─────────────────┘ │
│  Agent Status      │                       │
│  Quick Launch      │  Drawers: Chat (380px)│
│                    │           Briefing    │
└────────────────────┴───────────────────────┘
```

- Each project window is an independent `BrowserWindow`
- Closing a project window does not close the app
- Window positions/sizes persisted to database
- Terminal tabs each get their own `node-pty` PTY process

### 12 GUI Panel Tabs

1. Dashboard — project-specific actions, cost, stats
2. Sessions — Claude session history with token/cost tracking
3. Tasks — Kanban board (todo / in_progress / done)
4. Notes — project notes with pinning and FTS search
5. Files — file browser with code viewer
6. Memory — MEMORY.md editor for Claude Code
7. Rules — CLAUDE.md instruction editor
8. Services — detected cloud services
9. Git — status, diff, staging, commits, GitHub PRs
10. Images — AI image generation via OpenRouter
11. Recordings — audio recording + transcription
12. Browser — embedded web browser with dev tools

## 5. Data Layer

### Database

- **Engine:** `better-sqlite3` (synchronous, fast, WAL-compatible)
- **Schema:** Identical to Swift version — 23 tables, same column names and types
- **Migrations:** Port all 18 GRDB migrations to sequential TypeScript migration runner
- **FTS:** SQLite FTS5 for notes and code chunks (same as Swift)
- **Vectors:** 1536-dim Float32 BLOBs with in-JS cosine similarity

### Database Location

| Platform | Path |
|----------|------|
| macOS | `~/Library/Application Support/CodeFire/codefire.db` (shared with Swift) |
| Windows | `%APPDATA%/CodeFire/codefire.db` |
| Linux | `~/.config/CodeFire/codefire.db` |

### Data Access Pattern

```
Main Process (Node.js)
  └── DatabaseService (singleton, better-sqlite3)
       ├── ProjectDAO
       ├── TaskDAO
       ├── NoteDAO
       ├── SessionDAO
       ├── ChunkDAO
       └── ...

Renderer Process (React)
  └── IPC calls to main process
       └── useProject(), useTasks(), useNotes() hooks
```

Heavy operations (full index rebuilds, bulk embedding generation) run in `worker_threads` to avoid blocking the main process.

## 6. Feature Technology Mapping

| Feature | Swift | Electron |
|---------|-------|----------|
| Terminal | SwiftTerm `LocalProcessTerminalView` | `xterm.js` + `node-pty` |
| Code Indexing | Custom chunker + GRDB | Same chunker in TS + `better-sqlite3` |
| Embeddings | OpenRouter via URLSession | OpenRouter via `fetch` |
| Vector Search | In-memory cosine similarity | Same algorithm with `Float32Array` |
| FTS Search | SQLite FTS5 | Same — FTS5 in `better-sqlite3` |
| File Watching | Custom FileWatcher (polling) | `chokidar` (native fs events) |
| Git Operations | Shell-out to `git` CLI | `child_process.execFile('git', ...)` |
| GitHub API | GraphQL via URLSession | GraphQL via `fetch` |
| Gmail | Google OAuth + REST | Same OAuth + REST in Node.js |
| Browser Panel | `WKWebView` | Electron `<webview>` tag |
| Screenshots | WKWebView snapshot | `webContents.capturePage()` |
| Network Inspector | WKWebView delegate | `webRequest` API |
| Console Logs | WKWebView message handler | `webContents.on('console-message')` |
| Audio Recording | AVAudioEngine | Web Audio API (`MediaRecorder`) |
| Transcription | WhisperKit (local Swift) | `whisper-node` (local whisper.cpp bindings) |
| Image Generation | OpenRouter API | Identical API calls |
| Kanban Board | Custom SwiftUI drag-drop | `@dnd-kit/core` |
| Code Editor | Custom syntax highlighting | CodeMirror 6 or Monaco Editor |
| Diff Viewer | Custom view | Monaco diff editor |
| Markdown Editor | TextEditor + rendering | `@uiw/react-md-editor` or CodeMirror |
| Keychain/Secrets | macOS Keychain | Electron `safeStorage` API |
| Session Parsing | JSONL file reader | `readline` + `JSON.parse` |
| MCP Server | Compiled Swift binary (stdio) | Node.js script (stdio) |
| System Tray | NSStatusItem | Electron `Tray` API |
| Auto-Updates | Sparkle | `electron-updater` |

## 7. MCP Server (Node.js)

The MCP server is a standalone Node.js entry point that Claude Code spawns via stdio. It:

- Shares the same database module as the Electron GUI
- Implements the same JSON-RPC tool definitions as the Swift MCP server
- Registers as `codefire-electron` (distinct from Swift's `codefire`)
- Packaged as a standalone script (or compiled with `pkg` for distribution)

### Exposed Tools (matching Swift MCP)

- Task CRUD: create, list, update, add notes, list notes
- Notes: create, list, get, update, delete, search (FTS)
- Code search: hybrid keyword + semantic search
- Context search: same as code search with additional filters
- Session history queries
- Browser commands: navigate, click, type, screenshot, etc.
- Git operations: status, diff, log, stage, commit
- Image generation/editing
- Environment detection: services, env files
- Network request inspection

## 8. Coexistence & Isolation

### Hard Rules

1. **No modifications to `Context/`** — the Electron folder is completely independent
2. **Append-only database migrations** — never drop tables, never rename columns
3. **Version-gated migrations** — if Swift schema is ahead, Electron skips gracefully
4. **Separate MCP command name** — `codefire-electron` vs `codefire`
5. **Separate config directories** — Electron caches/temp files in its own app data folder
6. **No workspace linking** — `electron/package.json` is standalone, no monorepo hoisting

### Concurrent Access Safety

- WAL mode handles multiple readers + one writer (proven by Swift GUI + MCP coexistence)
- `busy_timeout` pragma set to 5000ms
- Both apps can be open simultaneously without conflict
- `mcp-connections/` status files use PID-keyed filenames — no collision

### Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Electron migration breaks Swift schema | Append-only migrations, version check before applying |
| Both apps write same row simultaneously | WAL + busy_timeout (already proven pattern) |
| Both MCP servers run at once | Different command names, documentation warning |
| Electron build pollutes Swift project | Separate directory, separate `.gitignore` |
| Shared dependencies hoist to root | No workspace linking, independent `package.json` |

## 9. Packaging & Distribution

### electron-builder Configuration

| Platform | Format | Auto-Update |
|----------|--------|-------------|
| macOS | DMG + zip | `electron-updater` (GitHub Releases) |
| Windows | NSIS installer + portable | `electron-updater` (GitHub Releases) |
| Linux | AppImage + deb + rpm | `electron-updater` (GitHub Releases) |

### Bundled Assets

- `whisper-node` native binaries (per-platform)
- `better-sqlite3` native bindings (per-platform, rebuilt via `electron-rebuild`)
- `node-pty` native bindings (per-platform)
- App icons for all three platforms

### MCP Server Distribution

The Node.js MCP server script is bundled inside the Electron app resources and symlinked/copied to a discoverable location on install. Users run:

```bash
claude mcp add codefire-electron /path/to/mcp-server/index.js
```

## 10. Design System

### Colors

- **Primary accent:** CodeFire Orange `#f97316`
- **Success:** `#4ade80`
- **Warning:** `#fb923c`
- **Error:** `#ef4444`
- **Info:** `#3b82f6`
- **Dark mode by default**, respecting OS `prefers-color-scheme`

### Typography

- UI text: system font stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI', ...`)
- Code/paths: monospace (`'SF Mono', 'Cascadia Code', 'Fira Code', monospace`)
- Size scale: 9px (tiny) / 10px (xs) / 11px (sm) / 12px (base) / 13px (titles) / 15px (xl)

### Spacing & Layout

- Panel resize handles via `react-resizable-panels`
- Padding scale: 8, 10, 12, 16, 20, 24px
- Border radius: 5-8px
- Animations: 150ms easeInOut (200ms for drawer slides)
