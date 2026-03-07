<p align="center">
  <img src="assets/codefire-logo.png" alt="CodeFire" width="128">
</p>

<h1 align="center">CodeFire</h1>

<p align="center">
  <strong>Persistent memory for AI coding agents</strong><br>
  A Linux companion app for Claude Code, Gemini CLI, Codex CLI, and OpenCode
</p>

<p align="center">
  <a href="https://github.com/websitebutlers/codefire-app/releases/latest"><img src="https://img.shields.io/badge/download-Linux-green?style=flat-square" alt="Download Linux"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square" alt="MIT License"></a>
</p>

<p align="center">
  <a href="https://codefire.app">Website</a> · <a href="https://codefire.app/getting-started">Getting Started</a> · <a href="https://github.com/websitebutlers/codefire-app/discussions">Community</a> · <a href="https://github.com/websitebutlers/codefire-app/releases/latest">Download</a>
</p>

---

## What is CodeFire?

Your AI coding agent forgets everything between sessions. CodeFire fixes that.

It auto-discovers your projects, tracks tasks and sessions, monitors live coding activity, and exposes project data back to your AI via MCP — creating a persistent memory layer where your agent knows what you were working on, what decisions were made, and what's left to do.

> **This is a Linux-only fork** of the original [CodeFire](https://github.com/nicepkg/codefire) project, built with Electron / React / TypeScript.

### Features

- **Persistent memory** — Tasks, notes, and session context that survive across CLI sessions
- **Task tracking** — Drag-and-drop Kanban board with priorities, labels, and task notes
- **Live session monitoring** — Real-time token usage, cost tracking, and tool call stats
- **Semantic code search** — Vector + keyword hybrid search across your indexed codebase
- **Built-in terminal** — Tabbed terminal sessions alongside your project views, with show/hide toggle
- **Browser automation** — 40+ MCP tools for navigating, clicking, typing, screenshotting
- **Git integration** — Commits, staged changes, diffs, and branch management
- **AI chat** — Ask questions about your codebase with RAG-powered context
- **Image generation** — Text-to-image via OpenRouter (Gemini, DALL-E, etc.)
- **Notes & briefings** — Pin architecture decisions, capture gotchas, get AI-generated daily briefings
- **Gmail integration** — Sync emails into tasks with whitelist rules
- **MCP server** — 63 tools exposing project data to any AI coding CLI
- **Universal compatibility** — Works with Claude Code, Gemini CLI, Codex CLI, and OpenCode

<p align="center">
  <img src="assets/screenshot-01.png" alt="CodeFire — Planner view with Kanban board, task tracking, and project intelligence" width="100%">
</p>

## Download

| Format | Download | Notes |
|--------|----------|-------|
| **AppImage** | [CodeFire-1.1.1.AppImage](https://github.com/websitebutlers/codefire-app/releases/latest) | `chmod +x` and run. Works on any distro. |
| **deb** | [codefire-electron_1.1.1_amd64.deb](https://github.com/websitebutlers/codefire-app/releases/latest) | `sudo dpkg -i` for Debian/Ubuntu. |

> For detailed setup instructions including API key configuration, see the **[Getting Started guide](https://codefire.app/getting-started)**.

## Quick Start

### 1. Install & Open

Download the AppImage or deb above, install, and launch CodeFire.

### 2. Add Your OpenRouter API Key

Open Settings and go to the **Engine** tab. Paste your [OpenRouter API key](https://openrouter.ai/keys). This powers AI chat, semantic code search, and image generation.

### 3. Connect Your CLI

The fastest way is the one-click install — visit [codefire.app/getting-started](https://codefire.app/getting-started) and click the button for your CLI.

Or configure manually:

```bash
# Claude Code
claude mcp add codefire -- node ~/.config/CodeFire/mcp-server.js
```

<details>
<summary>Other CLI tools</summary>

**Gemini CLI** — `~/.gemini/settings.json`:
```json
{
  "mcpServers": {
    "codefire": {
      "command": "node",
      "args": ["~/.config/CodeFire/mcp-server.js"]
    }
  }
}
```

**Codex CLI** — `~/.codex/config.toml`:
```toml
[mcp_servers.codefire]
command = "node"
args = ["~/.config/CodeFire/mcp-server.js"]
```

**OpenCode** — `opencode.json` (project root):
```json
{
  "mcpServers": {
    "codefire": {
      "type": "local",
      "command": ["node", "~/.config/CodeFire/mcp-server.js"]
    }
  }
}
```

</details>

### 4. Start Coding

Open a project folder in CodeFire, then start a CLI session. Your agent now has access to persistent memory, task tracking, browser automation, and code search — all through MCP.

## MCP Server

CodeFire's MCP server exposes **63 tools** to your AI coding agent:

| Category | Tools | Examples |
|----------|-------|---------|
| **Tasks** | 6 | Create, update, list, and annotate tasks with notes |
| **Notes** | 5 | Create, search, pin, and manage project notes |
| **Projects** | 2 | List projects, get current project context |
| **Sessions** | 2 | List and search session history |
| **Code Search** | 1 | Full-text search across indexed codebase |
| **Browser** | 40+ | Navigate, click, type, screenshot, eval JS, manage cookies |
| **Images** | 1 | List generated images |
| **Clients** | 2 | List and create client groups |

## Build from Source

```bash
cd electron
npm install          # Install deps + rebuild native modules
npm run dev          # Start dev server + Electron
npm run build        # TypeScript compile + Vite build
npm test             # Run tests (Vitest)
npm run dist         # Package for Linux (AppImage + deb)
```

## Repository Structure

```
electron/       Linux app (Electron/React/TypeScript)
landing/        Marketing website (codefire.app)
assets/         Shared screenshots and branding
scripts/        Build and packaging scripts
CLAUDE.md       Architecture docs for AI coding agents
SECURITY.md     Security policy and vulnerability reporting
```

## Architecture

- **SQLite database** at `~/.config/CodeFire/codefire.db`
- **MCP server** communicates via stdio — no network listeners, fully local
- **Project discovery** scans `~/.claude/projects/` for Claude Code session data

### Electron Architecture

The Electron app follows strict **main/preload/renderer** process separation:

- **Main process** (`src/main/`) — Database, IPC handlers, services (Git, Terminal, Search, MCP)
- **Preload** (`src/preload/`) — Typed bridge exposing `window.api` via contextBridge
- **Renderer** (`src/renderer/`) — React 19 + Tailwind CSS 4 + Vite
- **MCP server** (`src/mcp/`) — Standalone Node.js process spawned by CLI tools

Path aliases: `@shared`, `@renderer`, `@main`

## Contributing

We welcome contributions! This is a Linux-focused fork.

- **[Getting Started guide](https://codefire.app/getting-started)** — Set up the app
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — Code style, branch naming, and PR guidelines
- **[SECURITY.md](SECURITY.md)** — Vulnerability reporting

### Priority Contribution Areas

1. **Semantic search improvements** — Local embedding fallback, reranking, better chunking
2. **Browser automation** — Network capture, session persistence, Web Vitals
3. **Testing** — Unit tests, MCP protocol tests, E2E browser tests
4. **MCP server extensions** — Git operations, custom tool plugins, metrics

## Requirements

- **Linux** x64 (tested on Arch, Ubuntu 20.04+, Fedora)
- **OpenRouter API key** for AI-powered features ([get one here](https://openrouter.ai/keys))
- An AI coding CLI: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [Codex CLI](https://github.com/openai/codex), or [OpenCode](https://github.com/sst/opencode)

## License

MIT
