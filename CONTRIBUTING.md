# Contributing to CodeFire

Thanks for your interest in contributing! CodeFire is a Linux-only Electron app with a companion MCP server.

## Repository Structure

```
electron/       Linux app (Electron/React/TypeScript)
landing/        Marketing website
assets/         Shared screenshots and branding
scripts/        Build and packaging scripts
```

## Which directory should I work in?

| If you're working on... | Go to... |
|------------------------|----------|
| App features or bugs | `electron/` |
| The marketing website | `landing/` |
| Build/packaging scripts | `scripts/` |

## Database Schema

The SQLite database lives at `~/.config/CodeFire/codefire.db`. Migrations are in `electron/src/main/database/migrations/index.ts`.

## Development Setup

```bash
cd electron
npm install
npm run dev
```

Requires Node.js 18+.

**Linux prerequisites:** The Electron app uses native modules (`better-sqlite3`, `node-pty`) that need to be compiled against Electron's Node headers. The `postinstall` script handles this automatically, but you need:
- **Python 3**
- **Build tools:** `base-devel` (Arch), `build-essential` (Debian/Ubuntu)

### Running Tests

```bash
cd electron
npm test
```

## Branch Naming

- `feature/<description>` — New features
- `fix/<description>` — Bug fixes
- `chore/<description>` — Maintenance, refactoring, docs

## Pull Request Guidelines

1. Target the `main` branch
2. Include a clear description of what changed and why
3. Keep PRs focused — one feature or fix per PR
4. Add tests for new functionality

## Code Style

- **Electron/React:** TypeScript with React. Use the existing patterns in `electron/src/renderer/` for components and hooks.
