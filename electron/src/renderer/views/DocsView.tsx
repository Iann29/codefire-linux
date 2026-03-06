import { BookOpen } from 'lucide-react'
import { useProjectDocs } from '@renderer/hooks/useProjectDocs'
import DocSidebar from '@renderer/components/Docs/DocSidebar'
import DocEditor from '@renderer/components/Docs/DocEditor'

interface DocsViewProps {
  projectId: string
}

export default function DocsView({ projectId }: DocsViewProps) {
  const { docs, selectedDoc, selectDoc, createDoc, updateDoc, deleteDoc, loading } = useProjectDocs(projectId)

  const handleCreate = async () => {
    await createDoc('Untitled', '')
  }

  const handleDelete = async (docId: string) => {
    await deleteDoc(docId)
  }

  if (loading && docs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-neutral-700 border-t-codefire-orange rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Sidebar */}
      <div className="w-[200px] shrink-0">
        <DocSidebar
          docs={docs}
          selectedDocId={selectedDoc?.id || null}
          onSelect={selectDoc}
          onCreate={handleCreate}
          onDelete={handleDelete}
        />
      </div>

      {/* Editor */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedDoc ? (
          <DocEditor doc={selectedDoc} onUpdate={updateDoc} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-4">
            <BookOpen size={32} className="text-neutral-700 mb-3" />
            <p className="text-xs text-neutral-500">
              {docs.length === 0
                ? 'No docs yet. Create one to get started.'
                : 'Select a doc from the sidebar'}
            </p>
            {docs.length === 0 && (
              <button
                onClick={handleCreate}
                className="mt-3 px-3 py-1.5 text-xs rounded bg-codefire-orange/10 text-codefire-orange hover:bg-codefire-orange/20 transition-colors"
              >
                Create your first doc
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
