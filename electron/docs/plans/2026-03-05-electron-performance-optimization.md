# Electron Performance Optimization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce startup time and memory footprint of the Electron app to be closer to the Swift app's performance.

**Architecture:** Defer heavy initialization, reduce bundle size, lazy-load views, and trim the asar.

**Tech Stack:** Vite code-splitting, dynamic imports, electron-builder file filtering

---

## Current State (Measured)

| Metric | Value |
|--------|-------|
| Total app size | 340 MB |
| asar bundle | 78 MB |
| asar.unpacked (native modules) | 15 MB |
| Files in asar | 11,269 (11,255 are node_modules) |
| Renderer JS bundle | 3.9 MB (single chunk) |
| Main process bundle | 132 KB |
| `lucide-react` in node_modules | 45 MB |
| `@uiw/react-md-editor` + deps | 12 MB |
| `@codemirror` | 3.4 MB |
| `@xterm` | 6.1 MB |

## Priority 1: Low-Hanging Fruit (Immediate Impact)

### Task 1: Tree-shake lucide-react icons [DONE]

**Problem:** `lucide-react` is 45 MB in node_modules and likely ships all 1500+ icons to the asar. Only ~20-30 icons are actually used.

**Resolution:** Vite already tree-shakes named imports (`import { X } from 'lucide-react'`). All renderer code uses named imports. Package excluded from asar via `build.files`.

**Files:**
- Modify: `electron/vite.config.ts` (or check current config)
- Check: All renderer files importing from `lucide-react`

**Step 1:** Audit which icons are imported across the codebase:
```bash
grep -rh "from 'lucide-react'" src/renderer/ | sort -u
```

**Step 2:** Verify Vite is tree-shaking lucide-react properly. If icons are imported as `import { X, Y } from 'lucide-react'`, Vite should tree-shake. If not, switch to direct imports: `import { X } from 'lucide-react/dist/esm/icons/x'`.

**Step 3:** Confirm the 3.9 MB renderer bundle shrinks after proper tree-shaking.

---

### Task 2: Defer heavy main-process initialization [DONE]

**Problem:** `index.ts` eagerly initializes everything at module load time — Gmail, MCP, SearchEngine, ContextEngine, EmbeddingClient, FileWatcher, BrowserCommandExecutor, LiveSessionWatcher — before the window even opens.

**Resolution:** Implemented `initDeferredServices()` pattern — all heavy services init after `ready-to-show` + 100ms delay. Only essential handlers (db, window, terminal, git, MCP) load eagerly.

**Files:**
- Modify: `electron/src/main/index.ts`

**Step 1:** Move these initializations inside `app.whenReady()`, after the window is created:
- `GmailService` → lazy, only if credentials exist
- `SearchEngine` + `ContextEngine` + `EmbeddingClient` → defer to after window shows
- `BrowserCommandExecutor` → already deferred, good
- `LiveSessionWatcher` → defer to after window shows
- `FileWatcher` → defer to after window shows

**Step 2:** Use `setImmediate()` or `setTimeout(fn, 0)` to push non-critical init after the event loop processes the window creation.

Pattern:
```typescript
app.whenReady().then(() => {
  const mainWin = windowManager.createMainWindow()

  // Show window ASAP, then init services
  mainWin.once('show', () => {
    setTimeout(() => {
      // Init search, context, gmail, file watcher, etc.
    }, 100)
  })
})
```

---

### Task 3: Trim node_modules from asar [DONE]

**Problem:** 11,255 node_modules files in the asar. Many are only needed at build time or are already bundled by Vite (renderer deps). Only main-process runtime deps need to be in the asar: `better-sqlite3`, `node-pty`, `chokidar`, `@modelcontextprotocol/sdk`, and their transitive deps.

**Resolution:** Extensive exclusion list in `build.files` — lucide-react, @codemirror, codemirror, @lezer, @xterm, @dnd-kit, react, react-dom, react-resizable-panels, react-markdown, rehype*, remark*, micromark*, mdast*, hast*, unified, unist*, vfile*, scheduler, style-mod, crelt, w3c-keyname.

**Files:**
- Modify: `electron/package.json` (`build.files` section)

**Step 1:** Add explicit excludes to the `files` config:
```json
"files": [
  "dist/**/*",
  "dist-electron/**/*",
  "node_modules/**/*",
  "!node_modules/lucide-react/**",
  "!node_modules/@codemirror/**",
  "!node_modules/codemirror/**",
  "!node_modules/@xterm/**",
  "!node_modules/@uiw/**",
  "!node_modules/react/**",
  "!node_modules/react-dom/**",
  "!node_modules/@dnd-kit/**",
  "!node_modules/react-resizable-panels/**",
  "!node_modules/@lezer/**",
  "!node_modules/refractor/**",
  "!node_modules/rehype*/**",
  "!node_modules/remark*/**",
  "!node_modules/react-markdown/**",
  "!node_modules/micromark*/**",
  "!node_modules/mdast*/**",
  "!node_modules/hast*/**",
  "!node_modules/unified/**",
  "!node_modules/unist*/**",
  "!node_modules/vfile*/**",
  "!node_modules/@tailwindcss/**",
  "!node_modules/tailwindcss/**",
  "!node_modules/@vitejs/**",
  "!node_modules/typescript/**",
  "!node_modules/vitest/**"
]
```

**Step 2:** Rebuild and verify the app still works. All renderer deps are bundled in `dist/assets/index-*.js` — they don't need to be in node_modules inside the asar.

**Step 3:** Measure new asar size. Target: < 20 MB (down from 78 MB).

---

### Task 4: Add Vite code splitting for heavy renderer views [DONE]

**Problem:** Single 3.9 MB renderer chunk means the entire UI (CodeMirror, xterm, markdown editor, all views) loads before anything renders.

**Resolution:** `React.lazy()` applied at multiple levels: `App.tsx` lazy-loads MainLayout, ProjectLayout, SettingsModal. `ProjectLayout.tsx` lazy-loads 13 heavy views (Sessions, Files, Browser, Git, etc.). `MainLayout.tsx` lazy-loads TerminalPanel and CodeFireChat. All wrapped in `<Suspense>` with appropriate fallbacks.

**Files:**
- Modify: `electron/src/renderer/App.tsx` or view imports
- Modify: `electron/vite.config.ts` (manualChunks if needed)

**Step 1:** Lazy-load heavy views with `React.lazy()`:
```typescript
const BrowserView = React.lazy(() => import('./views/BrowserView'))
const SessionsView = React.lazy(() => import('./views/SessionsView'))
const ChatView = React.lazy(() => import('./views/ChatView'))
const TerminalView = React.lazy(() => import('./views/TerminalView'))
```

**Step 2:** Wrap lazy components in `<Suspense fallback={<LoadingSpinner />}>`.

**Step 3:** Verify code splitting works — check `dist/assets/` for multiple JS chunks after build.

---

## Priority 2: Medium Effort (Significant Impact)

### Task 5: Optimize BrowserWindow creation [DONE]

**Resolution:** Both `MainWindow.ts` and `ProjectWindow.ts` already use `show: false` + `ready-to-show` pattern. No white flash on startup.

---

### Task 6: Replace @uiw/react-md-editor with lighter alternative [DONE]

**Problem:** `@uiw/react-md-editor` pulls in 12 MB of dependencies (rehype, remark, refractor, etc.) that all end up in the asar even though they're bundled by Vite.

**Resolution:** Replaced with lightweight textarea + preview in `NoteEditor.tsx`. Only one file used `@uiw/react-md-editor`. New editor uses a plain `<textarea>` for editing with tab support, and a built-in `simpleMarkdown()` function for preview (no external deps). Removed `@uiw/react-md-editor` from `package.json` entirely — saves ~12 MB of dependencies.

---

### Task 7: Reduce polling intervals [DONE]

**Problem:** Multiple polling loops running simultaneously:
- `BrowserCommandExecutor`: every 100ms
- `LiveSessionWatcher`: every 2s
- `MCPServerManager`: likely polling too

**Resolution:** Increased `BrowserCommandExecutor` poll from 100ms to 500ms. Still responsive enough for browser automation (legacy path — new agent uses IPC direct via BrowserBridge). `LiveSessionWatcher` at 2s is acceptable for file watching.

---

## Priority 3: Longer Term

### Task 8: Use `electron-builder` `twoPackageJson` structure [DONE]

**Resolution:** Moved all renderer-only dependencies (react, react-dom, lucide-react, @codemirror/*, @xterm/*, @dnd-kit/*, codemirror, react-resizable-panels) from `dependencies` to `devDependencies`. electron-builder only packages `dependencies` into the production asar, so renderer deps bundled by Vite no longer need to be in the asar. This eliminates the 23-line `build.files` exclusion list, replaced with a clean 3-line include pattern. Only main-process runtime deps remain in `dependencies`: better-sqlite3, node-pty, chokidar, @modelcontextprotocol/sdk, @supabase/supabase-js, zod.

### Task 9: Profile renderer startup with Chrome DevTools

Use `--inspect` flag and Chrome DevTools Performance tab to identify the actual bottleneck in renderer startup (is it parsing 3.9 MB of JS? DOM rendering? Data loading?).

### Task 10: Consider V8 snapshots

Electron supports V8 snapshots (`--js-flags="--snapshot_blob=..."`) to pre-compile JavaScript, reducing parse time on startup.

---

## Expected Impact

| Optimization | Estimated Impact |
|-------------|-----------------|
| Trim asar node_modules | -60 MB asar, faster app load |
| Defer main process init | Window appears 1-2s sooner |
| Code-split renderer | Initial render 40-60% faster |
| ready-to-show pattern | Eliminates white flash |
| Reduce polling | Lower idle CPU usage |
| Replace md-editor | -12 MB dependencies |
