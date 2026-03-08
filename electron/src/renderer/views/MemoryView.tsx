import { useState, useEffect, useCallback } from 'react'
import { Brain, Loader2, Plus } from 'lucide-react'
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

export default function MemoryView({ projectId, projectPath }: MemoryViewProps) {
  const [files, setFiles] = useState<MemoryFile[]>([])
  const [selectedFile, setSelectedFile] = useState<MemoryFile | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [showNewModal, setShowNewModal] = useState(false)

  // Load file list
  const loadFiles = useCallback(async () => {
    try {
      const result = await api.memory.list(projectPath, projectId)
      setFiles(result)
      return result
    } catch (err) {
      console.error('Failed to load memory files:', err)
      return []
    }
  }, [projectPath, projectId])

  // Initial load
  useEffect(() => {
    let cancelled = false
    setLoading(true)

    loadFiles().then((result) => {
      if (!cancelled) setLoading(false)
      // Auto-select MEMORY.md if present
      if (!cancelled && result.length > 0) {
        const main = result.find((f) => f.isMain) ?? result[0]
        handleSelect(main)
      }
    })

    return () => {
      cancelled = true
    }
  }, [projectPath])

  // Select and load a file
  const handleSelect = useCallback(
    async (file: MemoryFile) => {
      setSelectedFile(file)
      try {
        const text = await api.memory.read(file.path)
        setContent(text)
      } catch (err) {
        console.error('Failed to read memory file:', err)
        setContent(null)
      }
    },
    []
  )

  // Save file content
  const handleSave = useCallback(async (filePath: string, newContent: string) => {
    await api.memory.write(filePath, newContent)
  }, [])

  // Delete a file
  const handleDelete = useCallback(
    async (file: MemoryFile) => {
      if (!confirm(`Delete ${file.name}?`)) return

      await api.memory.delete(file.path)

      // Clear selection if deleted file was selected
      if (selectedFile?.path === file.path) {
        setSelectedFile(null)
        setContent(null)
      }

      await loadFiles()
    },
    [selectedFile, loadFiles]
  )

  // Create a new file
  const handleCreate = useCallback(
    async (fileName: string, initialContent?: string) => {
      const newFile = await api.memory.create(projectPath, fileName, projectId)

      if (initialContent) {
        await api.memory.write(newFile.path, initialContent)
      }

      const updatedFiles = await loadFiles()
      // Select the newly created file
      const created = updatedFiles.find((f) => f.path === newFile.path)
      if (created) {
        handleSelect(created)
      }
    },
    [projectPath, projectId, loadFiles, handleSelect]
  )

  // Create MEMORY.md shortcut
  const handleCreateMain = useCallback(async () => {
    await handleCreate('MEMORY.md')
  }, [handleCreate])

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={20} className="animate-spin text-neutral-500" />
      </div>
    )
  }

  // Empty state — no files at all
  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-8">
        <Brain size={40} className="text-neutral-600 mb-4" />
        <h3 className="text-sm font-medium text-neutral-300 mb-1">No memory files yet</h3>
        <p className="text-xs text-neutral-500 mb-4 max-w-xs">
          Memory files give Claude persistent context about your project across sessions.
        </p>
        <button
          className="px-4 py-2 text-sm bg-codefire-orange text-white rounded-cf
                     hover:bg-codefire-orange-hover transition-colors flex items-center gap-2"
          onClick={handleCreateMain}
        >
          <Plus size={14} />
          Create MEMORY.md
        </button>
      </div>
    )
  }

  // Normal state — split view
  return (
    <div className="flex h-full">
      {/* Left panel — file list */}
      <div className="w-56 border-r border-neutral-800 shrink-0">
        <MemoryFileList
          files={files}
          selectedPath={selectedFile?.path ?? null}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onNew={() => setShowNewModal(true)}
        />
      </div>

      {/* Right panel — editor */}
      <div className="flex-1 min-w-0">
        <MemoryEditor
          fileName={selectedFile?.name ?? null}
          filePath={selectedFile?.path ?? null}
          isMain={selectedFile?.isMain ?? false}
          content={content}
          onSave={handleSave}
        />
      </div>

      {/* New file modal */}
      {showNewModal && (
        <NewMemoryModal
          onClose={() => setShowNewModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  )
}
