# Electron Port — Phase 1 Tab Views Design

**Date:** 2026-03-04
**Scope:** Finish Files tab, build Memory, Rules, Services, Git tabs

## Status

- **Built:** Dashboard, Sessions, Tasks (Kanban), Notes
- **In-progress:** Files (FileTree + CodeViewer + IPC complete, needs wiring into ProjectLayout)
- **This phase:** Memory, Rules, Services, Git
- **Phase 2:** Images, Browser (full DevTools), Recordings
- **Skipped:** Visualize (hidden in Swift app)

## Tab Designs

### Files (finish)

Already complete: `FileTree`, `FileTreeRow`, `CodeViewer` (CodeMirror), `file-handlers.ts` IPC.
Just needs: import in ProjectLayout, add to switch statement, commit.

### Memory

Horizontal split (30/70).

**Left panel:** "Memory Files" header + `+` new-file button. List of `.md` files from `~/.claude/projects/<encoded-path>/memory/`. Star icon for MEMORY.md, doc icon for others. Delete on hover. Footer: "Auto-loaded by Claude Code".

**Right panel:** Toolbar — filename badge (mono), "loaded every session" / "loaded when referenced" label, unsaved indicator (orange pill), Revert + Save buttons. Full-height CodeMirror (markdown, editable).

**Empty state:** Centered Brain icon, "No memory files", "Create MEMORY.md" button.

**New file modal:** Filename input (auto-appends .md) + optional content textarea.

**IPC channels:** `memory:list`, `memory:read`, `memory:write`, `memory:delete`, `memory:create`, `memory:getDir` (resolves/creates the memory directory path).

### Rules

Horizontal split (30/70), similar to Memory.

**Left panel:** "Rule Files" header. 3 fixed rows:
- Global (`~/.claude/CLAUDE.md`) — blue badge
- Project (`<project>/CLAUDE.md`) — purple badge
- Local (`<project>/.claude/CLAUDE.md`) — orange badge

Each: scope icon, scope name, exists indicator (green dot), create `+` button if missing.

**Right panel (exists):** Scope badge (colored), "CLAUDE.md" label, unsaved indicator, "Generate with AI" button (purple), Revert + Save. Full-height CodeMirror (markdown, editable).

**Right panel (not exists):** Centered icon, title, path, "Create with Template" button (scope-colored) + "Generate with AI" (purple).

**Footer:** "Load Order: Global → Project → Local. Later files override earlier ones."

**IPC channels:** `rules:list` (returns all 3 with exists status), `rules:read`, `rules:write`, `rules:create`.

### Services

Single scrollable column, 3 collapsible sections.

**Section 1 — Services:** Cards for detected services (icon, name, config path, "Open Dashboard" link). Uses existing `services:detect` IPC.

**Section 2 — Environment Variables:** Horizontal tab strip for multiple .env files. Below: key=masked-value list, reveal on click. Copy button per file.

**Section 3 — Environment Builder:** Template file cards (.env.example, .env.template). "Generate .env" button → modal with target filename, variable form, generate button.

**New IPC:** `services:listEnvFiles`, `services:readEnvFile`, `services:scanTemplates`, `services:generateEnv`.

### Git

Single scrollable column, richest tab.

**Header:** Branch name (mono, accent) + change count badge (orange) + refresh button.

**Commit Composer:** Multi-line message textarea (60px), "Stage All" (green) + "Unstage All" (orange), "Commit" button (blue, disabled until staged + message).

**4 collapsible sections:**
1. Staged Changes (green) — file rows with M/A/D badge, unstage button
2. Changes (orange) — file rows with stage button
3. Untracked (gray) — file rows with stage button
4. Recent Commits — SHA (mono, accent), message, relative time

**Inline diff:** Click file row to toggle. Line numbers (old+new columns), green/red line coloring, mono font.

**GitHub section (conditional):**
- Pull Requests: number, title, author, branch, draft badge, +/- stats, CI icon, review icon
- CI/Workflows: name, branch, event, status icon (colored)
- Issues: number, title, label pills (colored)

**IPC:** Existing git handlers. Add `git:diff-file` for per-file diffs. Existing GitHub handlers.

## Shared Patterns

All tabs follow established conventions:
- `text-xs`, `text-sm` sizing, `text-neutral-400` secondary text
- `border-neutral-800` separators
- `bg-neutral-900` backgrounds, `bg-neutral-800/60` hover states
- `codefire-orange` accent color
- Lucide React icons, 14-16px
- CodeMirror with `oneDark` theme for editors
- `react-resizable-panels` for split layouts
- Collapsible sections: chevron icon + title + count badge + toggle state
