# Electron Phase 1 Tabs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Wire up the in-progress Files tab, then build Memory, Rules, Services, and Git tab views to match the Swift app's UI/UX.

**Architecture:** Each tab is a standalone React component in `src/renderer/views/` with supporting components in `src/renderer/components/<TabName>/`. IPC handlers in `src/main/ipc/` bridge to the filesystem or Git CLI. All tabs use the same design tokens (neutral-800/900 borders/backgrounds, codefire-orange accent, Lucide icons, CodeMirror with oneDark for editors).

**Tech Stack:** React 18, TypeScript, Tailwind CSS v4, CodeMirror 6 (editors), Lucide React (icons), react-resizable-panels (split layouts), better-sqlite3 (database)

---

### Task 1: Wire Files tab into ProjectLayout

**Files:**
- Modify: `electron/src/renderer/layouts/ProjectLayout.tsx`

**Step 1: Add import and switch case**

Add FilesView import and case to ProjectLayout:

```tsx
// Add import at top (after NotesView import, line 10)
import FilesView from '@renderer/views/FilesView'

// Add case in renderActiveView switch (after 'Notes' case, ~line 90)
case 'Files':
  return <FilesView projectId={pid} projectPath={project!.path} />
```

**Step 2: Verify it builds**

Run: `cd electron && npm run build`
Expected: Clean build, no errors

**Step 3: Commit**

```bash
git add electron/src/renderer/layouts/ProjectLayout.tsx \
  electron/src/renderer/views/FilesView.tsx \
  electron/src/renderer/components/Files/ \
  electron/src/main/ipc/file-handlers.ts \
  electron/src/main/ipc/service-handlers.ts \
  electron/src/main/ipc/index.ts \
  electron/src/renderer/lib/api.ts \
  electron/src/shared/types.ts \
  electron/package.json electron/package-lock.json
git commit -m "feat: add Files tab with file tree and CodeMirror viewer"
```

---

### Task 2: Memory tab — IPC handlers

**Files:**
- Create: `electron/src/main/ipc/memory-handlers.ts`
- Modify: `electron/src/main/ipc/index.ts` (add import + registration)
- Modify: `electron/src/shared/types.ts` (add MemoryChannel type)
- Modify: `electron/src/renderer/lib/api.ts` (add api.memory namespace)

**Step 1: Create memory-handlers.ts**

```ts
import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import * as crypto from 'crypto'

export interface MemoryFile {
  name: string
  path: string
  isMain: boolean // true for MEMORY.md
}

/**
 * Encode a project path to the same format Claude Code uses for its memory directory.
 * Claude Code uses: ~/.claude/projects/<encoded-path>/memory/
 * The encoded path replaces '/' with '-' and prepends '-'.
 */
function encodeProjectPath(projectPath: string): string {
  return '-' + projectPath.replace(/\//g, '-')
}

function getMemoryDir(projectPath: string): string {
  const encoded = encodeProjectPath(projectPath)
  return path.join(os.homedir(), '.claude', 'projects', encoded, 'memory')
}

export function registerMemoryHandlers() {
  ipcMain.handle('memory:getDir', (_event, projectPath: string): string => {
    if (!projectPath || typeof projectPath !== 'string') {
      throw new Error('projectPath is required')
    }
    return getMemoryDir(projectPath)
  })

  ipcMain.handle('memory:list', (_event, projectPath: string): MemoryFile[] => {
    if (!projectPath || typeof projectPath !== 'string') {
      throw new Error('projectPath is required')
    }

    const dir = getMemoryDir(projectPath)
    if (!fs.existsSync(dir)) {
      return []
    }

    try {
      const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
      // Sort: MEMORY.md first, then alphabetical
      entries.sort((a, b) => {
        if (a === 'MEMORY.md') return -1
        if (b === 'MEMORY.md') return 1
        return a.localeCompare(b)
      })

      return entries.map((name) => ({
        name,
        path: path.join(dir, name),
        isMain: name === 'MEMORY.md',
      }))
    } catch {
      return []
    }
  })

  ipcMain.handle('memory:read', (_event, filePath: string): string => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('filePath is required')
    }
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to read memory file: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  ipcMain.handle('memory:write', (_event, filePath: string, content: string): void => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('filePath is required')
    }
    if (typeof content !== 'string') {
      throw new Error('content must be a string')
    }
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(filePath, content, 'utf-8')
  })

  ipcMain.handle('memory:delete', (_event, filePath: string): void => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('filePath is required')
    }
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
  })

  ipcMain.handle(
    'memory:create',
    (_event, projectPath: string, fileName: string, content?: string): MemoryFile => {
      if (!projectPath || typeof projectPath !== 'string') {
        throw new Error('projectPath is required')
      }
      if (!fileName || typeof fileName !== 'string') {
        throw new Error('fileName is required')
      }
      // Ensure .md extension
      const name = fileName.endsWith('.md') ? fileName : `${fileName}.md`
      const dir = getMemoryDir(projectPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      const filePath = path.join(dir, name)
      fs.writeFileSync(filePath, content ?? '', 'utf-8')
      return { name, path: filePath, isMain: name === 'MEMORY.md' }
    }
  )
}
```

**Step 2: Wire into IPC index**

In `electron/src/main/ipc/index.ts`, add:
```ts
import { registerMemoryHandlers } from './memory-handlers'
// ... in registerAllHandlers():
registerMemoryHandlers()
```

**Step 3: Add types**

In `electron/src/shared/types.ts`:
```ts
export type MemoryChannel =
  | 'memory:getDir'
  | 'memory:list'
  | 'memory:read'
  | 'memory:write'
  | 'memory:delete'
  | 'memory:create'
```
Add `| MemoryChannel` to the `IpcChannel` union.

**Step 4: Add api namespace**

In `electron/src/renderer/lib/api.ts`:
```ts
memory: {
  getDir: (projectPath: string) =>
    invoke('memory:getDir', projectPath) as Promise<string>,
  list: (projectPath: string) =>
    invoke('memory:list', projectPath) as Promise<
      Array<{ name: string; path: string; isMain: boolean }>
    >,
  read: (filePath: string) =>
    invoke('memory:read', filePath) as Promise<string>,
  write: (filePath: string, content: string) =>
    invoke('memory:write', filePath, content) as Promise<void>,
  delete: (filePath: string) =>
    invoke('memory:delete', filePath) as Promise<void>,
  create: (projectPath: string, fileName: string, content?: string) =>
    invoke('memory:create', projectPath, fileName, content) as Promise<
      { name: string; path: string; isMain: boolean }
    >,
},
```

**Step 5: Commit**

```bash
git add electron/src/main/ipc/memory-handlers.ts \
  electron/src/main/ipc/index.ts \
  electron/src/shared/types.ts \
  electron/src/renderer/lib/api.ts
git commit -m "feat: add memory file IPC handlers"
```

---

### Task 3: Memory tab — UI components

**Files:**
- Create: `electron/src/renderer/components/Memory/MemoryFileList.tsx`
- Create: `electron/src/renderer/components/Memory/MemoryEditor.tsx`
- Create: `electron/src/renderer/components/Memory/NewMemoryModal.tsx`
- Create: `electron/src/renderer/views/MemoryView.tsx`
- Modify: `electron/src/renderer/layouts/ProjectLayout.tsx` (add import + case)

**Step 1: Create MemoryFileList.tsx**

Left panel component. Shows list of .md files with star icon for MEMORY.md, delete button on hover, "+ New" button in header.

```tsx
import { Star, FileText, Plus, Trash2 } from 'lucide-react'

interface MemoryFile {
  name: string
  path: string
  isMain: boolean
}

interface MemoryFileListProps {
  files: MemoryFile[]
  selectedPath: string | null
  onSelect: (file: MemoryFile) => void
  onDelete: (file: MemoryFile) => void
  onNew: () => void
}

export default function MemoryFileList({
  files,
  selectedPath,
  onSelect,
  onDelete,
  onNew,
}: MemoryFileListProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800 shrink-0">
        <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wide">
          Memory Files
        </h3>
        <button
          onClick={onNew}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
          title="New memory file"
        >
          <Plus size={14} />
        </button>
      </div>

      {/* File list */}
      <div className="flex-1 overflow-y-auto py-1">
        {files.map((file) => (
          <button
            key={file.path}
            onClick={() => onSelect(file)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-sm group
              hover:bg-neutral-800/60 transition-colors
              ${selectedPath === file.path ? 'bg-neutral-800 text-neutral-100' : 'text-neutral-400'}`}
          >
            {file.isMain ? (
              <Star size={14} className="shrink-0 text-codefire-orange" />
            ) : (
              <FileText size={14} className="shrink-0 text-neutral-500" />
            )}
            <span className="truncate flex-1">{file.name}</span>
            {!file.isMain && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(file)
                }}
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-neutral-700 text-neutral-500 hover:text-red-400 transition-all"
                title="Delete"
              >
                <Trash2 size={12} />
              </button>
            )}
          </button>
        ))}
      </div>

      {/* Footer hint */}
      <div className="px-3 py-2 border-t border-neutral-800 shrink-0">
        <p className="text-[10px] text-neutral-600">Auto-loaded by Claude Code</p>
      </div>
    </div>
  )
}
```

**Step 2: Create MemoryEditor.tsx**

Right panel with CodeMirror markdown editor, toolbar with filename badge, save/revert, unsaved indicator.

```tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { Save, RotateCcw, Brain } from 'lucide-react'
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'

interface MemoryEditorProps {
  fileName: string | null
  filePath: string | null
  isMain: boolean
  content: string
  onSave: (content: string) => Promise<void>
}

export default function MemoryEditor({
  fileName,
  filePath,
  isMain,
  content,
  onSave,
}: MemoryEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [currentContent, setCurrentContent] = useState(content)
  const [saving, setSaving] = useState(false)
  const unsaved = currentContent !== content

  // Rebuild editor when file changes
  useEffect(() => {
    if (!filePath || !editorRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    setCurrentContent(content)

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setCurrentContent(update.state.doc.toString())
      }
    })

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        oneDark,
        updateListener,
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'transparent' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid #333' },
        }),
      ],
    })

    viewRef.current = new EditorView({ state, parent: editorRef.current })

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [filePath, content])

  const handleSave = useCallback(async () => {
    if (!unsaved || saving) return
    setSaving(true)
    try {
      await onSave(currentContent)
    } finally {
      setSaving(false)
    }
  }, [currentContent, unsaved, saving, onSave])

  const handleRevert = useCallback(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      changes: { from: 0, to: viewRef.current.state.doc.length, insert: content },
    })
    setCurrentContent(content)
  }, [content])

  if (!filePath) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-600">
        <Brain size={32} className="mb-2" />
        <p className="text-sm">Select a memory file to edit</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
        <span className="text-xs font-mono bg-neutral-800 px-2 py-0.5 rounded text-neutral-300">
          {fileName}
        </span>
        <span className="text-[10px] text-neutral-600">
          {isMain ? 'loaded every session' : 'loaded when referenced'}
        </span>
        <div className="flex-1" />
        {unsaved && (
          <span className="text-[10px] bg-codefire-orange/20 text-codefire-orange px-2 py-0.5 rounded-full">
            Unsaved
          </span>
        )}
        <button
          onClick={handleRevert}
          disabled={!unsaved}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-30"
          title="Revert changes"
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={handleSave}
          disabled={!unsaved || saving}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-30"
          title="Save (Cmd+S)"
        >
          <Save size={14} />
        </button>
      </div>

      {/* Editor */}
      <div ref={editorRef} className="flex-1 overflow-hidden" />
    </div>
  )
}
```

**Step 3: Create NewMemoryModal.tsx**

Simple modal with filename input + optional content textarea.

```tsx
import { useState } from 'react'
import { X } from 'lucide-react'

interface NewMemoryModalProps {
  onClose: () => void
  onCreate: (fileName: string, content?: string) => Promise<void>
}

export default function NewMemoryModal({ onClose, onCreate }: NewMemoryModalProps) {
  const [fileName, setFileName] = useState('')
  const [content, setContent] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async () => {
    if (!fileName.trim() || creating) return
    setCreating(true)
    try {
      await onCreate(fileName.trim(), content || undefined)
      onClose()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-neutral-700 rounded-lg w-96 p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-neutral-200">New Memory File</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-neutral-800 text-neutral-500">
            <X size={14} />
          </button>
        </div>

        <label className="block text-xs text-neutral-400 mb-1">Filename</label>
        <div className="flex items-center gap-1 mb-3">
          <input
            type="text"
            value={fileName}
            onChange={(e) => setFileName(e.target.value)}
            placeholder="e.g. patterns"
            autoFocus
            className="flex-1 bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-neutral-200
              placeholder:text-neutral-600 focus:outline-none focus:border-codefire-orange"
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
          />
          <span className="text-xs text-neutral-600">.md</span>
        </div>

        <label className="block text-xs text-neutral-400 mb-1">Initial content (optional)</label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={4}
          placeholder="# My Notes"
          className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-neutral-200
            font-mono placeholder:text-neutral-600 focus:outline-none focus:border-codefire-orange resize-none mb-1"
        />
        <p className="text-[10px] text-neutral-600 mb-4">
          Link from MEMORY.md to load automatically
        </p>

        <button
          onClick={handleCreate}
          disabled={!fileName.trim() || creating}
          className="w-full bg-codefire-orange/20 text-codefire-orange border border-codefire-orange/30 rounded py-1.5 text-sm
            hover:bg-codefire-orange/30 transition-colors disabled:opacity-40"
        >
          Create
        </button>
      </div>
    </div>
  )
}
```

**Step 4: Create MemoryView.tsx**

The main view composing the left/right panels.

```tsx
import { useState, useEffect, useCallback } from 'react'
import { Loader2, Brain, Plus } from 'lucide-react'
import { api } from '@renderer/lib/api'
import MemoryFileList from '@renderer/components/Memory/MemoryFileList'
import MemoryEditor from '@renderer/components/Memory/MemoryEditor'
import NewMemoryModal from '@renderer/components/Memory/NewMemoryModal'

interface MemoryFile {
  name: string
  path: string
  isMain: boolean
}

interface MemoryViewProps {
  projectId: string
  projectPath: string
}

export default function MemoryView({ projectPath }: MemoryViewProps) {
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [selected, setSelected] = useState<MemoryFile | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [showNewModal, setShowNewModal] = useState(false)

  const loadFiles = useCallback(async () => {
    try {
      const result = await api.memory.list(projectPath)
      setFiles(result)
    } catch (err) {
      console.error('Failed to list memory files:', err)
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  const handleSelect = useCallback(async (file: MemoryFile) => {
    setSelected(file)
    try {
      const text = await api.memory.read(file.path)
      setContent(text)
    } catch (err) {
      console.error('Failed to read file:', err)
      setContent('')
    }
  }, [])

  const handleSave = useCallback(
    async (newContent: string) => {
      if (!selected) return
      await api.memory.write(selected.path, newContent)
      setContent(newContent)
    },
    [selected]
  )

  const handleDelete = useCallback(
    async (file: MemoryFile) => {
      await api.memory.delete(file.path)
      if (selected?.path === file.path) {
        setSelected(null)
        setContent('')
      }
      await loadFiles()
    },
    [selected, loadFiles]
  )

  const handleCreate = useCallback(
    async (fileName: string, initialContent?: string) => {
      const newFile = await api.memory.create(projectPath, fileName, initialContent)
      await loadFiles()
      await handleSelect(newFile)
    },
    [projectPath, loadFiles, handleSelect]
  )

  const handleCreateMemoryMd = useCallback(async () => {
    await handleCreate('MEMORY.md', '# Project Memory\n\nKey decisions, patterns, and context.\n')
  }, [handleCreate])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  // Empty state — no memory directory yet
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-600">
        <Brain size={36} className="mb-3" />
        <p className="text-sm mb-1">No memory files</p>
        <p className="text-xs text-neutral-700 mb-4">
          Memory files persist context across Claude Code sessions
        </p>
        <button
          onClick={handleCreateMemoryMd}
          className="flex items-center gap-1.5 bg-codefire-orange/20 text-codefire-orange border border-codefire-orange/30 rounded px-3 py-1.5 text-sm
            hover:bg-codefire-orange/30 transition-colors"
        >
          <Plus size={14} />
          Create MEMORY.md
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex h-full">
        <div className="w-56 min-w-[180px] border-r border-neutral-800 shrink-0">
          <MemoryFileList
            files={files}
            selectedPath={selected?.path ?? null}
            onSelect={handleSelect}
            onDelete={handleDelete}
            onNew={() => setShowNewModal(true)}
          />
        </div>
        <div className="flex-1 min-w-0">
          <MemoryEditor
            fileName={selected?.name ?? null}
            filePath={selected?.path ?? null}
            isMain={selected?.isMain ?? false}
            content={content}
            onSave={handleSave}
          />
        </div>
      </div>

      {showNewModal && (
        <NewMemoryModal
          onClose={() => setShowNewModal(false)}
          onCreate={handleCreate}
        />
      )}
    </>
  )
}
```

**Step 5: Add to ProjectLayout**

In `ProjectLayout.tsx`, add import and switch case:
```tsx
import MemoryView from '@renderer/views/MemoryView'

// In renderActiveView:
case 'Memory':
  return <MemoryView projectId={pid} projectPath={project!.path} />
```

**Step 6: Verify build**

Run: `cd electron && npm run build`
Expected: Clean build

**Step 7: Commit**

```bash
git add electron/src/renderer/components/Memory/ \
  electron/src/renderer/views/MemoryView.tsx \
  electron/src/renderer/layouts/ProjectLayout.tsx
git commit -m "feat: add Memory tab with file list and markdown editor"
```

---

### Task 4: Rules tab — IPC handlers

**Files:**
- Create: `electron/src/main/ipc/rules-handlers.ts`
- Modify: `electron/src/main/ipc/index.ts`
- Modify: `electron/src/shared/types.ts`
- Modify: `electron/src/renderer/lib/api.ts`

**Step 1: Create rules-handlers.ts**

```ts
import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'

export interface RuleFile {
  scope: 'global' | 'project' | 'local'
  label: string
  path: string
  exists: boolean
  color: string // tailwind color class
}

function getRuleFiles(projectPath: string): RuleFile[] {
  const globalPath = path.join(os.homedir(), '.claude', 'CLAUDE.md')
  const projectFilePath = path.join(projectPath, 'CLAUDE.md')
  const localPath = path.join(projectPath, '.claude', 'CLAUDE.md')

  return [
    {
      scope: 'global',
      label: 'Global',
      path: globalPath,
      exists: fs.existsSync(globalPath),
      color: 'blue',
    },
    {
      scope: 'project',
      label: 'Project',
      path: projectFilePath,
      exists: fs.existsSync(projectFilePath),
      color: 'purple',
    },
    {
      scope: 'local',
      label: 'Local',
      path: localPath,
      exists: fs.existsSync(localPath),
      color: 'orange',
    },
  ]
}

export function registerRulesHandlers() {
  ipcMain.handle('rules:list', (_event, projectPath: string): RuleFile[] => {
    if (!projectPath || typeof projectPath !== 'string') {
      throw new Error('projectPath is required')
    }
    return getRuleFiles(projectPath)
  })

  ipcMain.handle('rules:read', (_event, filePath: string): string => {
    if (!filePath || typeof filePath !== 'string') {
      throw new Error('filePath is required')
    }
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch (err) {
      throw new Error(`Failed to read: ${err instanceof Error ? err.message : String(err)}`)
    }
  })

  ipcMain.handle('rules:write', (_event, filePath: string, content: string): void => {
    if (!filePath || typeof filePath !== 'string') throw new Error('filePath is required')
    if (typeof content !== 'string') throw new Error('content must be a string')
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, content, 'utf-8')
  })

  ipcMain.handle(
    'rules:create',
    (_event, filePath: string, template?: string): void => {
      if (!filePath || typeof filePath !== 'string') throw new Error('filePath is required')
      const dir = path.dirname(filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

      const content = template ?? `# CLAUDE.md\n\n## Project Overview\n\n## Code Style\n\n## Important Patterns\n\n## Testing\n\n`
      fs.writeFileSync(filePath, content, 'utf-8')
    }
  )
}
```

**Step 2: Wire into IPC index, types, and api**

Same pattern as Memory (Task 2 steps 2-4):
- Import + call `registerRulesHandlers()` in index.ts
- Add `RulesChannel` type: `'rules:list' | 'rules:read' | 'rules:write' | 'rules:create'`
- Add `api.rules` namespace

**Step 3: Commit**

```bash
git add electron/src/main/ipc/rules-handlers.ts \
  electron/src/main/ipc/index.ts \
  electron/src/shared/types.ts \
  electron/src/renderer/lib/api.ts
git commit -m "feat: add CLAUDE.md rules file IPC handlers"
```

---

### Task 5: Rules tab — UI components

**Files:**
- Create: `electron/src/renderer/components/Rules/RuleFileList.tsx`
- Create: `electron/src/renderer/components/Rules/RuleEditor.tsx`
- Create: `electron/src/renderer/views/RulesView.tsx`
- Modify: `electron/src/renderer/layouts/ProjectLayout.tsx`

**Step 1: Create RuleFileList.tsx**

Left panel with 3 fixed rows (Global/Project/Local), colored scope badges, green dot for existing files, create button for missing ones.

```tsx
import { Globe, FolderOpen, FileCode, Plus, Circle } from 'lucide-react'

interface RuleFile {
  scope: 'global' | 'project' | 'local'
  label: string
  path: string
  exists: boolean
  color: string
}

interface RuleFileListProps {
  files: RuleFile[]
  selectedScope: string | null
  onSelect: (file: RuleFile) => void
  onCreate: (file: RuleFile) => void
}

const scopeIcons = {
  global: Globe,
  project: FolderOpen,
  local: FileCode,
}

const scopeColors: Record<string, string> = {
  blue: 'text-blue-400',
  purple: 'text-purple-400',
  orange: 'text-codefire-orange',
}

const scopeBgColors: Record<string, string> = {
  blue: 'bg-blue-400/10',
  purple: 'bg-purple-400/10',
  orange: 'bg-codefire-orange/10',
}

export default function RuleFileList({
  files,
  selectedScope,
  onSelect,
  onCreate,
}: RuleFileListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-neutral-800 shrink-0">
        <h3 className="text-xs font-medium text-neutral-400 uppercase tracking-wide">Rule Files</h3>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {files.map((file) => {
          const Icon = scopeIcons[file.scope]
          const colorClass = scopeColors[file.color]
          const bgClass = scopeBgColors[file.color]

          return (
            <button
              key={file.scope}
              onClick={() => onSelect(file)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left group
                hover:bg-neutral-800/60 transition-colors
                ${selectedScope === file.scope ? 'bg-neutral-800' : ''}`}
            >
              <div className={`p-1 rounded ${bgClass}`}>
                <Icon size={14} className={colorClass} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`text-sm ${selectedScope === file.scope ? 'text-neutral-100' : 'text-neutral-300'}`}>
                    {file.label}
                  </span>
                  {file.exists && <Circle size={6} className="fill-green-500 text-green-500" />}
                </div>
                <p className="text-[10px] text-neutral-600 truncate">
                  {file.exists ? 'CLAUDE.md' : 'Not created'}
                </p>
              </div>
              {!file.exists && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onCreate(file)
                  }}
                  className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-neutral-700 text-neutral-500 hover:text-neutral-300 transition-all"
                  title="Create"
                >
                  <Plus size={12} />
                </button>
              )}
            </button>
          )
        })}
      </div>

      <div className="px-3 py-2 border-t border-neutral-800 shrink-0">
        <p className="text-[10px] text-neutral-600">
          Load Order: Global → Project → Local
        </p>
        <p className="text-[10px] text-neutral-600">
          Later files override earlier ones
        </p>
      </div>
    </div>
  )
}
```

**Step 2: Create RuleEditor.tsx**

Same pattern as MemoryEditor — CodeMirror markdown editor with save/revert toolbar, scope badge, "Create with Template" empty state. Copy MemoryEditor's CodeMirror setup but add scope-colored badge and create/generate buttons for non-existent files.

```tsx
import { useEffect, useRef, useState, useCallback } from 'react'
import { Save, RotateCcw, ScrollText, Plus, Sparkles } from 'lucide-react'
import { EditorView, lineNumbers, highlightActiveLine, keymap } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'

interface RuleEditorProps {
  scope: string | null
  label: string | null
  color: string
  filePath: string | null
  exists: boolean
  content: string
  onSave: (content: string) => Promise<void>
  onCreate: () => void
}

const borderColors: Record<string, string> = {
  blue: 'border-blue-400/30',
  purple: 'border-purple-400/30',
  orange: 'border-codefire-orange/30',
}

const textColors: Record<string, string> = {
  blue: 'text-blue-400',
  purple: 'text-purple-400',
  orange: 'text-codefire-orange',
}

const bgColors: Record<string, string> = {
  blue: 'bg-blue-400/20',
  purple: 'bg-purple-400/20',
  orange: 'bg-codefire-orange/20',
}

export default function RuleEditor({
  scope,
  label,
  color,
  filePath,
  exists,
  content,
  onSave,
  onCreate,
}: RuleEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const [currentContent, setCurrentContent] = useState(content)
  const [saving, setSaving] = useState(false)
  const unsaved = currentContent !== content

  useEffect(() => {
    if (!filePath || !exists || !editorRef.current) return

    if (viewRef.current) {
      viewRef.current.destroy()
      viewRef.current = null
    }

    setCurrentContent(content)

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        setCurrentContent(update.state.doc.toString())
      }
    })

    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        markdown(),
        oneDark,
        updateListener,
        EditorView.theme({
          '&': { height: '100%', backgroundColor: 'transparent' },
          '.cm-scroller': { overflow: 'auto' },
          '.cm-gutters': { backgroundColor: 'transparent', borderRight: '1px solid #333' },
        }),
      ],
    })

    viewRef.current = new EditorView({ state, parent: editorRef.current })

    return () => {
      if (viewRef.current) {
        viewRef.current.destroy()
        viewRef.current = null
      }
    }
  }, [filePath, exists, content])

  const handleSave = useCallback(async () => {
    if (!unsaved || saving) return
    setSaving(true)
    try { await onSave(currentContent) } finally { setSaving(false) }
  }, [currentContent, unsaved, saving, onSave])

  const handleRevert = useCallback(() => {
    if (!viewRef.current) return
    viewRef.current.dispatch({
      changes: { from: 0, to: viewRef.current.state.doc.length, insert: content },
    })
    setCurrentContent(content)
  }, [content])

  if (!scope) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-600">
        <ScrollText size={32} className="mb-2" />
        <p className="text-sm">Select a rule file to edit</p>
      </div>
    )
  }

  if (!exists) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-600 gap-3">
        <ScrollText size={36} className="mb-1" />
        <p className="text-sm text-neutral-400">{label} CLAUDE.md</p>
        <p className="text-xs text-neutral-600 max-w-xs text-center">{filePath}</p>
        <button
          onClick={onCreate}
          className={`flex items-center gap-1.5 ${bgColors[color]} ${textColors[color]} border ${borderColors[color]} rounded px-3 py-1.5 text-sm
            hover:opacity-80 transition-opacity mt-2`}
        >
          <Plus size={14} />
          Create with Template
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 shrink-0">
        <span className={`text-[10px] ${bgColors[color]} ${textColors[color]} px-2 py-0.5 rounded-full`}>
          {label}
        </span>
        <span className="text-xs font-mono text-neutral-400">CLAUDE.md</span>
        <div className="flex-1" />
        {unsaved && (
          <span className="text-[10px] bg-codefire-orange/20 text-codefire-orange px-2 py-0.5 rounded-full">
            Unsaved
          </span>
        )}
        <button onClick={handleRevert} disabled={!unsaved}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-30" title="Revert">
          <RotateCcw size={14} />
        </button>
        <button onClick={handleSave} disabled={!unsaved || saving}
          className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors disabled:opacity-30" title="Save">
          <Save size={14} />
        </button>
      </div>

      <div ref={editorRef} className="flex-1 overflow-hidden" />
    </div>
  )
}
```

**Step 3: Create RulesView.tsx**

```tsx
import { useState, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { api } from '@renderer/lib/api'
import RuleFileList from '@renderer/components/Rules/RuleFileList'
import RuleEditor from '@renderer/components/Rules/RuleEditor'

interface RuleFile {
  scope: 'global' | 'project' | 'local'
  label: string
  path: string
  exists: boolean
  color: string
}

interface RulesViewProps {
  projectId: string
  projectPath: string
}

export default function RulesView({ projectPath }: RulesViewProps) {
  const [files, setFiles] = useState<RuleFile[]>([])
  const [selected, setSelected] = useState<RuleFile | null>(null)
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)

  const loadFiles = useCallback(async () => {
    try {
      const result = await api.rules.list(projectPath)
      setFiles(result)
      // Update selected file's exists status
      if (selected) {
        const updated = result.find((f) => f.scope === selected.scope)
        if (updated) setSelected(updated)
      }
    } catch (err) {
      console.error('Failed to list rules:', err)
    } finally {
      setLoading(false)
    }
  }, [projectPath, selected])

  useEffect(() => { loadFiles() }, [loadFiles])

  const handleSelect = useCallback(async (file: RuleFile) => {
    setSelected(file)
    if (file.exists) {
      try {
        const text = await api.rules.read(file.path)
        setContent(text)
      } catch {
        setContent('')
      }
    } else {
      setContent('')
    }
  }, [])

  const handleSave = useCallback(async (newContent: string) => {
    if (!selected) return
    await api.rules.write(selected.path, newContent)
    setContent(newContent)
  }, [selected])

  const handleCreate = useCallback(async (file?: RuleFile) => {
    const target = file ?? selected
    if (!target) return
    await api.rules.create(target.path)
    await loadFiles()
    // Re-select to load content
    const text = await api.rules.read(target.path)
    setContent(text)
    setSelected({ ...target, exists: true })
  }, [selected, loadFiles])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  return (
    <div className="flex h-full">
      <div className="w-52 min-w-[180px] border-r border-neutral-800 shrink-0">
        <RuleFileList
          files={files}
          selectedScope={selected?.scope ?? null}
          onSelect={handleSelect}
          onCreate={handleCreate}
        />
      </div>
      <div className="flex-1 min-w-0">
        <RuleEditor
          scope={selected?.scope ?? null}
          label={selected?.label ?? null}
          color={selected?.color ?? 'blue'}
          filePath={selected?.path ?? null}
          exists={selected?.exists ?? false}
          content={content}
          onSave={handleSave}
          onCreate={() => handleCreate()}
        />
      </div>
    </div>
  )
}
```

**Step 4: Add to ProjectLayout**

```tsx
import RulesView from '@renderer/views/RulesView'

case 'Rules':
  return <RulesView projectId={pid} projectPath={project!.path} />
```

**Step 5: Verify build, commit**

```bash
git add electron/src/renderer/components/Rules/ \
  electron/src/renderer/views/RulesView.tsx \
  electron/src/renderer/layouts/ProjectLayout.tsx
git commit -m "feat: add Rules tab with CLAUDE.md editor (global/project/local)"
```

---

### Task 6: Services tab — IPC handlers for env files

**Files:**
- Modify: `electron/src/main/ipc/service-handlers.ts` (add env file handlers)
- Modify: `electron/src/shared/types.ts`
- Modify: `electron/src/renderer/lib/api.ts`

**Step 1: Add env file handlers to service-handlers.ts**

Append these handlers in `registerServiceHandlers()`:

```ts
ipcMain.handle(
  'services:listEnvFiles',
  (_event, projectPath: string): Array<{ name: string; path: string; varCount: number }> => {
    if (!projectPath || typeof projectPath !== 'string') throw new Error('projectPath required')

    try {
      const entries = fs.readdirSync(projectPath)
      return entries
        .filter((e) => e === '.env' || e.startsWith('.env.'))
        .map((name) => {
          const fullPath = path.join(projectPath, name)
          const content = fs.readFileSync(fullPath, 'utf-8')
          const varCount = content.split('\n').filter((l) => l.trim() && !l.startsWith('#') && l.includes('=')).length
          return { name, path: fullPath, varCount }
        })
    } catch {
      return []
    }
  }
)

ipcMain.handle(
  'services:readEnvFile',
  (_event, filePath: string): Array<{ key: string; value: string; comment?: string }> => {
    if (!filePath || typeof filePath !== 'string') throw new Error('filePath required')

    const content = fs.readFileSync(filePath, 'utf-8')
    const vars: Array<{ key: string; value: string; comment?: string }> = []
    let pendingComment: string | undefined

    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) { pendingComment = undefined; continue }
      if (trimmed.startsWith('#')) {
        pendingComment = trimmed.slice(1).trim()
        continue
      }
      const eqIdx = trimmed.indexOf('=')
      if (eqIdx > 0) {
        vars.push({
          key: trimmed.slice(0, eqIdx).trim(),
          value: trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, ''),
          comment: pendingComment,
        })
        pendingComment = undefined
      }
    }
    return vars
  }
)

ipcMain.handle(
  'services:scanTemplates',
  (_event, projectPath: string): Array<{ name: string; path: string; vars: Array<{ key: string; comment?: string; defaultValue?: string }> }> => {
    if (!projectPath || typeof projectPath !== 'string') throw new Error('projectPath required')

    const templateNames = ['.env.example', '.env.template', '.env.sample']
    const results: Array<{ name: string; path: string; vars: Array<{ key: string; comment?: string; defaultValue?: string }> }> = []

    for (const name of templateNames) {
      const fullPath = path.join(projectPath, name)
      if (!fs.existsSync(fullPath)) continue

      const content = fs.readFileSync(fullPath, 'utf-8')
      const vars: Array<{ key: string; comment?: string; defaultValue?: string }> = []
      let pendingComment: string | undefined

      for (const line of content.split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) { pendingComment = undefined; continue }
        if (trimmed.startsWith('#')) { pendingComment = trimmed.slice(1).trim(); continue }
        const eqIdx = trimmed.indexOf('=')
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim()
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '')
          vars.push({ key, comment: pendingComment, defaultValue: val || undefined })
          pendingComment = undefined
        }
      }

      results.push({ name, path: fullPath, vars })
    }

    return results
  }
)
```

**Step 2: Update types and api**

Add to `ServiceChannel`: `| 'services:listEnvFiles' | 'services:readEnvFile' | 'services:scanTemplates'`

Add to `api.services`:
```ts
listEnvFiles: (projectPath: string) =>
  invoke('services:listEnvFiles', projectPath) as Promise<Array<{ name: string; path: string; varCount: number }>>,
readEnvFile: (filePath: string) =>
  invoke('services:readEnvFile', filePath) as Promise<Array<{ key: string; value: string; comment?: string }>>,
scanTemplates: (projectPath: string) =>
  invoke('services:scanTemplates', projectPath) as Promise<Array<{ name: string; path: string; vars: Array<{ key: string; comment?: string; defaultValue?: string }> }>>,
```

**Step 3: Commit**

```bash
git add electron/src/main/ipc/service-handlers.ts \
  electron/src/shared/types.ts \
  electron/src/renderer/lib/api.ts
git commit -m "feat: add env file listing, parsing, and template scanning IPC"
```

---

### Task 7: Services tab — UI components

**Files:**
- Create: `electron/src/renderer/components/Services/ServiceCard.tsx`
- Create: `electron/src/renderer/components/Services/EnvFilePanel.tsx`
- Create: `electron/src/renderer/components/Services/CollapsibleSection.tsx`
- Create: `electron/src/renderer/views/ServicesView.tsx`
- Modify: `electron/src/renderer/layouts/ProjectLayout.tsx`

**Step 1: Create CollapsibleSection.tsx**

Reusable section header with chevron toggle, title, count badge. This pattern is used across Services and Git tabs.

```tsx
import { useState } from 'react'
import { ChevronRight, ChevronDown } from 'lucide-react'

interface CollapsibleSectionProps {
  title: string
  count?: number
  icon?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}

export default function CollapsibleSection({
  title,
  count,
  icon,
  defaultOpen = true,
  children,
}: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="mb-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-neutral-800/40 rounded transition-colors"
      >
        {open ? (
          <ChevronDown size={14} className="text-neutral-500" />
        ) : (
          <ChevronRight size={14} className="text-neutral-500" />
        )}
        {icon}
        <span className="text-xs font-medium text-neutral-300 uppercase tracking-wide">
          {title}
        </span>
        {count !== undefined && (
          <span className="text-[10px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded-full">
            {count}
          </span>
        )}
      </button>
      {open && <div className="mt-1">{children}</div>}
    </div>
  )
}
```

**Step 2: Create ServiceCard.tsx**

Card showing detected service with icon, name, config path, dashboard link.

```tsx
import { ExternalLink } from 'lucide-react'
import * as Icons from 'lucide-react'

interface ServiceCardProps {
  name: string
  configFile: string
  dashboardUrl: string | null
  icon: string
}

export default function ServiceCard({ name, configFile, dashboardUrl, icon }: ServiceCardProps) {
  // Dynamic icon lookup from lucide-react
  const IconComponent = (Icons as Record<string, React.FC<{ size?: number; className?: string }>>)[icon] ?? Icons.Box

  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-neutral-800/40 rounded-lg border border-neutral-800">
      <div className="p-2 bg-neutral-800 rounded-lg">
        <IconComponent size={16} className="text-codefire-orange" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-neutral-200">{name}</p>
        <p className="text-[10px] text-neutral-600 truncate">{configFile}</p>
      </div>
      {dashboardUrl && (
        <a
          href={dashboardUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-xs text-codefire-orange hover:text-codefire-orange/80 transition-colors"
          onClick={(e) => {
            e.preventDefault()
            window.open(dashboardUrl, '_blank')
          }}
        >
          Open
          <ExternalLink size={12} />
        </a>
      )}
    </div>
  )
}
```

**Step 3: Create EnvFilePanel.tsx**

Panel showing env file variables with masked values, tab strip for multiple files.

```tsx
import { useState, useEffect } from 'react'
import { Eye, EyeOff, Copy, KeyRound } from 'lucide-react'
import { api } from '@renderer/lib/api'

interface EnvFile {
  name: string
  path: string
  varCount: number
}

interface EnvVar {
  key: string
  value: string
  comment?: string
}

interface EnvFilePanelProps {
  files: EnvFile[]
}

export default function EnvFilePanel({ files }: EnvFilePanelProps) {
  const [activeFile, setActiveFile] = useState<EnvFile>(files[0])
  const [vars, setVars] = useState<EnvVar[]>([])
  const [revealed, setRevealed] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!activeFile) return
    api.services.readEnvFile(activeFile.path).then(setVars).catch(console.error)
    setRevealed(new Set())
  }, [activeFile])

  const toggleReveal = (key: string) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (files.length === 0) return null

  return (
    <div className="px-3">
      {/* Tab strip */}
      {files.length > 1 && (
        <div className="flex gap-1 mb-2 overflow-x-auto">
          {files.map((f) => (
            <button
              key={f.name}
              onClick={() => setActiveFile(f)}
              className={`text-xs px-2 py-1 rounded whitespace-nowrap transition-colors
                ${activeFile.name === f.name
                  ? 'bg-neutral-700 text-neutral-200'
                  : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800'}`}
            >
              {f.name}
              <span className="ml-1 text-neutral-600">({f.varCount})</span>
            </button>
          ))}
        </div>
      )}

      {/* Var list */}
      <div className="space-y-1">
        {vars.map((v) => (
          <div
            key={v.key}
            className="flex items-center gap-2 px-2 py-1 bg-neutral-800/40 rounded text-xs group"
          >
            <KeyRound size={12} className="text-neutral-600 shrink-0" />
            <span className="font-mono text-neutral-300 shrink-0">{v.key}</span>
            <span className="text-neutral-600">=</span>
            <span className="font-mono text-neutral-500 truncate flex-1">
              {revealed.has(v.key) ? v.value : '••••••••'}
            </span>
            <button
              onClick={() => toggleReveal(v.key)}
              className="p-0.5 opacity-0 group-hover:opacity-100 text-neutral-600 hover:text-neutral-400 transition-all"
            >
              {revealed.has(v.key) ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Step 4: Create ServicesView.tsx**

Compose 3 collapsible sections.

```tsx
import { useState, useEffect } from 'react'
import { Loader2, Cloud, KeyRound, FileText } from 'lucide-react'
import { api } from '@renderer/lib/api'
import CollapsibleSection from '@renderer/components/Services/CollapsibleSection'
import ServiceCard from '@renderer/components/Services/ServiceCard'
import EnvFilePanel from '@renderer/components/Services/EnvFilePanel'

interface ServicesViewProps {
  projectId: string
  projectPath: string
}

export default function ServicesView({ projectPath }: ServicesViewProps) {
  const [services, setServices] = useState<Array<{ name: string; configFile: string; configPath: string; dashboardUrl: string | null; icon: string }>>([])
  const [envFiles, setEnvFiles] = useState<Array<{ name: string; path: string; varCount: number }>>([])
  const [templates, setTemplates] = useState<Array<{ name: string; path: string; vars: Array<{ key: string; comment?: string; defaultValue?: string }> }>>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.services.detect(projectPath),
      api.services.listEnvFiles(projectPath),
      api.services.scanTemplates(projectPath),
    ])
      .then(([svc, env, tmpl]) => {
        setServices(svc)
        setEnvFiles(env)
        setTemplates(tmpl)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [projectPath])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  const isEmpty = services.length === 0 && envFiles.length === 0 && templates.length === 0

  if (isEmpty) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-neutral-600">
        <Cloud size={36} className="mb-3" />
        <p className="text-sm">No services detected</p>
        <p className="text-xs text-neutral-700 mt-1">
          Add service config files (firebase.json, vercel.json, etc.) to detect them
        </p>
      </div>
    )
  }

  return (
    <div className="p-4 overflow-y-auto h-full">
      {services.length > 0 && (
        <CollapsibleSection
          title="Services"
          count={services.length}
          icon={<Cloud size={14} className="text-blue-400" />}
        >
          <div className="space-y-2 px-3">
            {services.map((svc) => (
              <ServiceCard key={svc.name} {...svc} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {envFiles.length > 0 && (
        <CollapsibleSection
          title="Environment Variables"
          count={envFiles.reduce((sum, f) => sum + f.varCount, 0)}
          icon={<KeyRound size={14} className="text-green-400" />}
        >
          <EnvFilePanel files={envFiles} />
        </CollapsibleSection>
      )}

      {templates.length > 0 && (
        <CollapsibleSection
          title="Environment Templates"
          count={templates.length}
          icon={<FileText size={14} className="text-purple-400" />}
        >
          <div className="space-y-2 px-3">
            {templates.map((tmpl) => (
              <div key={tmpl.name} className="px-3 py-2 bg-neutral-800/40 rounded-lg border border-neutral-800">
                <p className="text-sm text-neutral-300">{tmpl.name}</p>
                <p className="text-[10px] text-neutral-600">{tmpl.vars.length} variables defined</p>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}
```

**Step 5: Add to ProjectLayout**

```tsx
import ServicesView from '@renderer/views/ServicesView'

case 'Services':
  return <ServicesView projectId={pid} projectPath={project!.path} />
```

**Step 6: Verify build, commit**

```bash
git add electron/src/renderer/components/Services/ \
  electron/src/renderer/views/ServicesView.tsx \
  electron/src/renderer/layouts/ProjectLayout.tsx
git commit -m "feat: add Services tab with detected services, env vars, and templates"
```

---

### Task 8: Git tab — UI components

**Files:**
- Create: `electron/src/renderer/components/Git/GitHeader.tsx`
- Create: `electron/src/renderer/components/Git/CommitComposer.tsx`
- Create: `electron/src/renderer/components/Git/FileRow.tsx`
- Create: `electron/src/renderer/components/Git/DiffViewer.tsx`
- Create: `electron/src/renderer/components/Git/CommitRow.tsx`
- Create: `electron/src/renderer/components/Git/GitHubSection.tsx`
- Create: `electron/src/renderer/hooks/useGit.ts`
- Create: `electron/src/renderer/views/GitView.tsx`
- Modify: `electron/src/renderer/layouts/ProjectLayout.tsx`

**Step 1: Create useGit.ts hook**

```ts
import { useState, useEffect, useCallback } from 'react'
import { api } from '@renderer/lib/api'

interface GitFile {
  status: string // 'M', 'A', 'D', '??', 'MM', etc.
  path: string
}

interface GitCommit {
  hash: string
  author: string
  email: string
  date: string
  subject: string
  body: string
}

interface GitStatus {
  branch: string
  staged: GitFile[]
  unstaged: GitFile[]
  untracked: GitFile[]
  isClean: boolean
}

export function useGit(projectPath: string) {
  const [status, setStatus] = useState<GitStatus>({
    branch: '',
    staged: [],
    unstaged: [],
    untracked: [],
    isClean: true,
  })
  const [commits, setCommits] = useState<GitCommit[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const [statusResult, logResult] = await Promise.all([
        api.git.status(projectPath),
        api.git.log(projectPath, { limit: 15 }),
      ])

      // Categorize files by git status
      const staged: GitFile[] = []
      const unstaged: GitFile[] = []
      const untracked: GitFile[] = []

      for (const file of statusResult.files) {
        const x = file.status[0] // index status
        const y = file.status[1] // worktree status

        if (file.status === '??') {
          untracked.push({ status: '?', path: file.path })
        } else {
          if (x && x !== ' ' && x !== '?') {
            staged.push({ status: x, path: file.path })
          }
          if (y && y !== ' ' && y !== '?') {
            unstaged.push({ status: y, path: file.path })
          }
        }
      }

      setStatus({
        branch: statusResult.branch,
        staged,
        unstaged,
        untracked,
        isClean: statusResult.isClean,
      })
      setCommits(logResult)
    } catch (err) {
      console.error('Failed to load git status:', err)
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  useEffect(() => {
    refresh()
  }, [refresh])

  const stageFiles = useCallback(
    async (files: string[]) => {
      await api.git.stage(projectPath, files)
      await refresh()
    },
    [projectPath, refresh]
  )

  const unstageFiles = useCallback(
    async (files: string[]) => {
      await api.git.unstage(projectPath, files)
      await refresh()
    },
    [projectPath, refresh]
  )

  const stageAll = useCallback(async () => {
    const allFiles = [...status.unstaged, ...status.untracked].map((f) => f.path)
    if (allFiles.length > 0) {
      await api.git.stage(projectPath, allFiles)
      await refresh()
    }
  }, [projectPath, status, refresh])

  const unstageAll = useCallback(async () => {
    const allFiles = status.staged.map((f) => f.path)
    if (allFiles.length > 0) {
      await api.git.unstage(projectPath, allFiles)
      await refresh()
    }
  }, [projectPath, status, refresh])

  const commit = useCallback(
    async (message: string) => {
      await api.git.commit(projectPath, message)
      await refresh()
    },
    [projectPath, refresh]
  )

  const getDiff = useCallback(
    async (file: string, staged?: boolean) => {
      return api.git.diff(projectPath, { file, staged })
    },
    [projectPath]
  )

  return {
    ...status,
    commits,
    loading,
    refresh,
    stageFiles,
    unstageFiles,
    stageAll,
    unstageAll,
    commit,
    getDiff,
  }
}
```

**Step 2: Create GitHeader.tsx**

```tsx
import { GitBranch, RefreshCw } from 'lucide-react'

interface GitHeaderProps {
  branch: string
  changeCount: number
  onRefresh: () => void
}

export default function GitHeader({ branch, changeCount, onRefresh }: GitHeaderProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-800">
      <GitBranch size={14} className="text-codefire-orange" />
      <span className="text-sm font-mono text-codefire-orange">{branch || 'detached'}</span>
      {changeCount > 0 && (
        <span className="text-[10px] bg-codefire-orange/20 text-codefire-orange px-1.5 py-0.5 rounded-full">
          {changeCount}
        </span>
      )}
      <div className="flex-1" />
      <button
        onClick={onRefresh}
        className="p-1 rounded hover:bg-neutral-800 text-neutral-500 hover:text-neutral-300 transition-colors"
        title="Refresh"
      >
        <RefreshCw size={14} />
      </button>
    </div>
  )
}
```

**Step 3: Create CommitComposer.tsx**

```tsx
import { useState } from 'react'

interface CommitComposerProps {
  stagedCount: number
  onStageAll: () => void
  onUnstageAll: () => void
  onCommit: (message: string) => Promise<void>
}

export default function CommitComposer({
  stagedCount,
  onStageAll,
  onUnstageAll,
  onCommit,
}: CommitComposerProps) {
  const [message, setMessage] = useState('')
  const [committing, setCommitting] = useState(false)
  const canCommit = stagedCount > 0 && message.trim().length > 0 && !committing

  const handleCommit = async () => {
    if (!canCommit) return
    setCommitting(true)
    try {
      await onCommit(message.trim())
      setMessage('')
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div className="px-4 py-3 border-b border-neutral-800">
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Commit message..."
        rows={2}
        className="w-full bg-neutral-800 border border-neutral-700 rounded px-2 py-1.5 text-sm text-neutral-200
          font-mono placeholder:text-neutral-600 focus:outline-none focus:border-codefire-orange resize-none mb-2"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.metaKey && canCommit) {
            e.preventDefault()
            handleCommit()
          }
        }}
      />
      <div className="flex items-center gap-2">
        <button
          onClick={onStageAll}
          className="text-xs bg-green-500/10 text-green-400 border border-green-500/20 rounded px-2 py-1 hover:bg-green-500/20 transition-colors"
        >
          Stage All
        </button>
        <button
          onClick={onUnstageAll}
          className="text-xs bg-codefire-orange/10 text-codefire-orange border border-codefire-orange/20 rounded px-2 py-1 hover:bg-codefire-orange/20 transition-colors"
        >
          Unstage All
        </button>
        <div className="flex-1" />
        <button
          onClick={handleCommit}
          disabled={!canCommit}
          className="text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded px-3 py-1
            hover:bg-blue-500/20 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          {committing ? 'Committing...' : 'Commit'}
        </button>
      </div>
    </div>
  )
}
```

**Step 4: Create FileRow.tsx**

```tsx
import { Plus, Minus } from 'lucide-react'

interface FileRowProps {
  path: string
  status: string
  type: 'staged' | 'unstaged' | 'untracked'
  isExpanded: boolean
  onClick: () => void
  onAction: () => void
}

const statusColors: Record<string, string> = {
  M: 'text-codefire-orange bg-codefire-orange/20',
  A: 'text-green-400 bg-green-400/20',
  D: 'text-red-400 bg-red-400/20',
  R: 'text-blue-400 bg-blue-400/20',
  '?': 'text-neutral-400 bg-neutral-400/20',
}

export default function FileRow({
  path,
  status,
  type,
  isExpanded,
  onClick,
  onAction,
}: FileRowProps) {
  const colorClass = statusColors[status] ?? 'text-neutral-400 bg-neutral-400/20'
  const fileName = path.split('/').pop() ?? path
  const dirPath = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''

  return (
    <div
      className={`flex items-center gap-2 px-4 py-1 hover:bg-neutral-800/40 cursor-pointer group transition-colors
        ${isExpanded ? 'bg-neutral-800/30' : ''}`}
      onClick={onClick}
    >
      <span className={`text-[10px] font-mono w-5 text-center rounded px-0.5 ${colorClass}`}>
        {status}
      </span>
      <span className="text-xs text-neutral-600 truncate">{dirPath}</span>
      <span className="text-xs text-neutral-300">{fileName}</span>
      <div className="flex-1" />
      <button
        onClick={(e) => {
          e.stopPropagation()
          onAction()
        }}
        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-neutral-700 transition-all"
        title={type === 'staged' ? 'Unstage' : 'Stage'}
      >
        {type === 'staged' ? (
          <Minus size={12} className="text-codefire-orange" />
        ) : (
          <Plus size={12} className="text-green-400" />
        )}
      </button>
    </div>
  )
}
```

**Step 5: Create DiffViewer.tsx**

```tsx
interface DiffViewerProps {
  diff: string
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header'
  content: string
  oldLine?: number
  newLine?: number
}

function parseDiff(raw: string): DiffLine[] {
  const lines: DiffLine[] = []
  let oldLine = 0
  let newLine = 0

  for (const line of raw.split('\n')) {
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      if (match) {
        oldLine = parseInt(match[1], 10)
        newLine = parseInt(match[2], 10)
      }
      lines.push({ type: 'header', content: line })
    } else if (line.startsWith('+')) {
      lines.push({ type: 'add', content: line.slice(1), newLine: newLine++ })
    } else if (line.startsWith('-')) {
      lines.push({ type: 'remove', content: line.slice(1), oldLine: oldLine++ })
    } else if (line.startsWith(' ')) {
      lines.push({ type: 'context', content: line.slice(1), oldLine: oldLine++, newLine: newLine++ })
    }
  }

  return lines
}

const lineColors = {
  add: 'bg-green-500/10 text-green-300',
  remove: 'bg-red-500/10 text-red-300',
  context: 'text-neutral-400',
  header: 'bg-blue-500/10 text-blue-300',
}

export default function DiffViewer({ diff }: DiffViewerProps) {
  if (!diff.trim()) {
    return (
      <div className="px-4 py-2 text-xs text-neutral-600">No changes to display</div>
    )
  }

  const lines = parseDiff(diff)

  return (
    <div className="mx-4 mb-2 border border-neutral-800 rounded overflow-hidden max-h-72 overflow-y-auto">
      <div className="font-mono text-[11px] leading-5">
        {lines.map((line, i) => (
          <div key={i} className={`flex ${lineColors[line.type]} px-2`}>
            <span className="w-10 text-right text-neutral-600 select-none shrink-0 pr-1 border-r border-neutral-800">
              {line.oldLine ?? ''}
            </span>
            <span className="w-10 text-right text-neutral-600 select-none shrink-0 pr-1 border-r border-neutral-800">
              {line.newLine ?? ''}
            </span>
            <span className="w-4 text-center select-none shrink-0">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : line.type === 'header' ? '@@' : ''}
            </span>
            <span className="flex-1 whitespace-pre overflow-x-auto">{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
```

**Step 6: Create CommitRow.tsx**

```tsx
interface CommitRowProps {
  hash: string
  subject: string
  date: string
}

function relativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays}d ago`
  return date.toLocaleDateString()
}

export default function CommitRow({ hash, subject, date }: CommitRowProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 hover:bg-neutral-800/40 transition-colors">
      <span className="text-[11px] font-mono text-codefire-orange shrink-0">
        {hash.slice(0, 7)}
      </span>
      <span className="text-xs text-neutral-300 truncate flex-1">{subject}</span>
      <span className="text-[10px] text-neutral-600 shrink-0">{relativeTime(date)}</span>
    </div>
  )
}
```

**Step 7: Create GitHubSection.tsx**

Conditional section showing PRs, workflows, and issues from the GitHub service.

```tsx
import { useState, useEffect } from 'react'
import { api } from '@renderer/lib/api'
import CollapsibleSection from '@renderer/components/Services/CollapsibleSection'
import { GitPullRequest, Workflow, CircleDot, Loader2, CheckCircle, XCircle, Clock } from 'lucide-react'

interface GitHubSectionProps {
  projectPath: string
}

export default function GitHubSection({ projectPath }: GitHubSectionProps) {
  const [repoInfo, setRepoInfo] = useState<{ owner: string; repo: string } | null>(null)
  const [prs, setPrs] = useState<any[]>([])
  const [workflows, setWorkflows] = useState<any[]>([])
  const [issues, setIssues] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      try {
        const info = await api.github.getRepoInfo(projectPath)
        if (!info) { setLoading(false); return }
        setRepoInfo(info)

        const [prResult, wfResult, issResult] = await Promise.all([
          api.github.listPRs(info.owner, info.repo, { state: 'OPEN', limit: 10 }),
          api.github.listWorkflows(info.owner, info.repo, { limit: 10 }),
          api.github.listIssues(info.owner, info.repo, { state: 'OPEN', limit: 10 }),
        ])

        setPrs(prResult)
        setWorkflows(wfResult)
        setIssues(issResult)
      } catch {
        // GitHub not available
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [projectPath])

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-4 py-2">
        <Loader2 size={14} className="animate-spin text-neutral-500" />
        <span className="text-xs text-neutral-600">Checking GitHub...</span>
      </div>
    )
  }

  if (!repoInfo) return null

  return (
    <div className="mt-4 pt-4 border-t border-neutral-800">
      <div className="px-4 mb-2">
        <span className="text-xs text-neutral-500">
          {repoInfo.owner}/{repoInfo.repo}
        </span>
      </div>

      {prs.length > 0 && (
        <CollapsibleSection
          title="Pull Requests"
          count={prs.length}
          icon={<GitPullRequest size={14} className="text-purple-400" />}
        >
          <div className="px-3">
            {prs.map((pr: any) => (
              <div key={pr.number} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-800/40 rounded transition-colors">
                <span className="text-xs text-purple-400 font-mono shrink-0">#{pr.number}</span>
                <span className="text-xs text-neutral-300 truncate flex-1">{pr.title}</span>
                {pr.isDraft && (
                  <span className="text-[10px] bg-neutral-800 text-neutral-500 px-1.5 rounded">draft</span>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {workflows.length > 0 && (
        <CollapsibleSection
          title="CI / Workflows"
          count={workflows.length}
          icon={<Workflow size={14} className="text-cyan-400" />}
        >
          <div className="px-3">
            {workflows.map((wf: any, i: number) => (
              <div key={i} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-800/40 rounded transition-colors">
                {wf.conclusion === 'success' ? (
                  <CheckCircle size={12} className="text-green-400 shrink-0" />
                ) : wf.conclusion === 'failure' ? (
                  <XCircle size={12} className="text-red-400 shrink-0" />
                ) : (
                  <Clock size={12} className="text-codefire-orange shrink-0" />
                )}
                <span className="text-xs text-neutral-300 truncate flex-1">{wf.name}</span>
                <span className="text-[10px] text-neutral-600 font-mono">{wf.headBranch}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {issues.length > 0 && (
        <CollapsibleSection
          title="Issues"
          count={issues.length}
          icon={<CircleDot size={14} className="text-yellow-400" />}
        >
          <div className="px-3">
            {issues.map((issue: any) => (
              <div key={issue.number} className="flex items-center gap-2 px-2 py-1.5 hover:bg-neutral-800/40 rounded transition-colors">
                <span className="text-xs text-yellow-400 font-mono shrink-0">#{issue.number}</span>
                <span className="text-xs text-neutral-300 truncate flex-1">{issue.title}</span>
                {issue.labels?.map((label: any) => (
                  <span
                    key={label.name}
                    className="text-[10px] px-1.5 rounded-full"
                    style={{ backgroundColor: `#${label.color}30`, color: `#${label.color}` }}
                  >
                    {label.name}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  )
}
```

**Step 8: Create GitView.tsx**

Main view composing all Git components.

```tsx
import { useState, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { GitCommit as GitCommitIcon, Circle } from 'lucide-react'
import { useGit } from '@renderer/hooks/useGit'
import GitHeader from '@renderer/components/Git/GitHeader'
import CommitComposer from '@renderer/components/Git/CommitComposer'
import FileRow from '@renderer/components/Git/FileRow'
import DiffViewer from '@renderer/components/Git/DiffViewer'
import CommitRow from '@renderer/components/Git/CommitRow'
import CollapsibleSection from '@renderer/components/Services/CollapsibleSection'
import GitHubSection from '@renderer/components/Git/GitHubSection'

interface GitViewProps {
  projectId: string
  projectPath: string
}

export default function GitView({ projectPath }: GitViewProps) {
  const {
    branch,
    staged,
    unstaged,
    untracked,
    commits,
    loading,
    refresh,
    stageFiles,
    unstageFiles,
    stageAll,
    unstageAll,
    commit,
    getDiff,
  } = useGit(projectPath)

  const [expandedFile, setExpandedFile] = useState<string | null>(null)
  const [diffContent, setDiffContent] = useState('')

  const toggleDiff = useCallback(
    async (filePath: string, isStaged: boolean) => {
      if (expandedFile === filePath) {
        setExpandedFile(null)
        setDiffContent('')
        return
      }
      setExpandedFile(filePath)
      try {
        const diff = await getDiff(filePath, isStaged)
        setDiffContent(diff)
      } catch {
        setDiffContent('')
      }
    },
    [expandedFile, getDiff]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  const totalChanges = staged.length + unstaged.length + untracked.length

  return (
    <div className="flex flex-col h-full">
      <GitHeader branch={branch} changeCount={totalChanges} onRefresh={refresh} />
      <CommitComposer
        stagedCount={staged.length}
        onStageAll={stageAll}
        onUnstageAll={unstageAll}
        onCommit={commit}
      />

      <div className="flex-1 overflow-y-auto">
        {staged.length > 0 && (
          <CollapsibleSection
            title="Staged Changes"
            count={staged.length}
            icon={<Circle size={8} className="fill-green-400 text-green-400" />}
          >
            {staged.map((f) => (
              <div key={`staged-${f.path}`}>
                <FileRow
                  path={f.path}
                  status={f.status}
                  type="staged"
                  isExpanded={expandedFile === f.path}
                  onClick={() => toggleDiff(f.path, true)}
                  onAction={() => unstageFiles([f.path])}
                />
                {expandedFile === f.path && <DiffViewer diff={diffContent} />}
              </div>
            ))}
          </CollapsibleSection>
        )}

        {unstaged.length > 0 && (
          <CollapsibleSection
            title="Changes"
            count={unstaged.length}
            icon={<Circle size={8} className="fill-codefire-orange text-codefire-orange" />}
          >
            {unstaged.map((f) => (
              <div key={`unstaged-${f.path}`}>
                <FileRow
                  path={f.path}
                  status={f.status}
                  type="unstaged"
                  isExpanded={expandedFile === f.path}
                  onClick={() => toggleDiff(f.path, false)}
                  onAction={() => stageFiles([f.path])}
                />
                {expandedFile === f.path && <DiffViewer diff={diffContent} />}
              </div>
            ))}
          </CollapsibleSection>
        )}

        {untracked.length > 0 && (
          <CollapsibleSection
            title="Untracked"
            count={untracked.length}
            icon={<Circle size={8} className="fill-neutral-500 text-neutral-500" />}
          >
            {untracked.map((f) => (
              <FileRow
                key={`untracked-${f.path}`}
                path={f.path}
                status={f.status}
                type="untracked"
                isExpanded={false}
                onClick={() => {}}
                onAction={() => stageFiles([f.path])}
              />
            ))}
          </CollapsibleSection>
        )}

        {commits.length > 0 && (
          <CollapsibleSection
            title="Recent Commits"
            count={commits.length}
            icon={<GitCommitIcon size={14} className="text-neutral-400" />}
          >
            {commits.map((c) => (
              <CommitRow key={c.hash} hash={c.hash} subject={c.subject} date={c.date} />
            ))}
          </CollapsibleSection>
        )}

        <GitHubSection projectPath={projectPath} />
      </div>
    </div>
  )
}
```

**Step 9: Add GitHub api methods**

In `api.ts`, add the missing `api.github` namespace:

```ts
github: {
  getRepoInfo: (projectPath: string) =>
    invoke('github:getRepoInfo', projectPath) as Promise<{ owner: string; repo: string } | null>,
  listPRs: (owner: string, repo: string, options?: { state?: string; limit?: number }) =>
    invoke('github:listPRs', owner, repo, options) as Promise<any[]>,
  listWorkflows: (owner: string, repo: string, options?: { limit?: number }) =>
    invoke('github:listWorkflows', owner, repo, options) as Promise<any[]>,
  listIssues: (owner: string, repo: string, options?: { state?: string; limit?: number; labels?: string[] }) =>
    invoke('github:listIssues', owner, repo, options) as Promise<any[]>,
},
```

**Step 10: Add to ProjectLayout**

```tsx
import GitView from '@renderer/views/GitView'

case 'Git':
  return <GitView projectId={pid} projectPath={project!.path} />
```

**Step 11: Verify build, commit**

```bash
git add electron/src/renderer/components/Git/ \
  electron/src/renderer/hooks/useGit.ts \
  electron/src/renderer/views/GitView.tsx \
  electron/src/renderer/layouts/ProjectLayout.tsx \
  electron/src/renderer/lib/api.ts
git commit -m "feat: add Git tab with status, staging, commits, diffs, and GitHub integration"
```

---

### Task 9: Add @codemirror/commands dependency

**Files:**
- Modify: `electron/package.json`

The Memory and Rules editors use `@codemirror/commands` for keybindings and history. Install it before building.

**Step 1: Install**

```bash
cd electron && npm install @codemirror/commands
```

**Step 2: Commit**

```bash
git add electron/package.json electron/package-lock.json
git commit -m "chore: add @codemirror/commands dependency for editor keybindings"
```

**Note:** This task should be done BEFORE Task 3 (Memory UI) since the editor components import from `@codemirror/commands`.

---

### Task 10: Final verification

**Step 1: Full build**

```bash
cd electron && npm run build
```

Expected: Clean build, no errors.

**Step 2: Type check**

```bash
cd electron && npx tsc --noEmit
```

Expected: No type errors.

**Step 3: Run tests**

```bash
cd electron && npm test
```

Expected: All existing tests pass.

**Step 4: Commit design doc**

```bash
git add docs/plans/2026-03-04-electron-phase1-tabs-design.md \
  docs/plans/2026-03-04-electron-phase1-tabs-implementation.md
git commit -m "docs: add Phase 1 tab implementation design and plan"
```

---

## Task Dependency Order

```
Task 9 (install @codemirror/commands)
  ↓
Task 1 (wire Files tab) — can be done independently
  ↓
Task 2 (Memory IPC) → Task 3 (Memory UI)
  ↓
Task 4 (Rules IPC) → Task 5 (Rules UI)
  ↓
Task 6 (Services IPC) → Task 7 (Services UI)
  ↓
Task 8 (Git UI — uses existing IPC + CollapsibleSection from Task 7)
  ↓
Task 10 (final verification)
```

Parallelizable:
- Tasks 1, 2, 4, 6, 9 are independent and can run in parallel
- Task 3 depends on 2 + 9
- Task 5 depends on 4 + 9
- Task 7 depends on 6
- Task 8 depends on 7 (for CollapsibleSection) + existing git IPC
